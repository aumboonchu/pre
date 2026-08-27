import { env } from 'cloudflare:workers'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import worker from './index'
import { hashPassword, login, SESSION_COOKIE } from './auth'

const ADMIN_ID = 'test-branch-delete-admin'
const ADMIN_PASSWORD = 'test-password-5432'
const BRANCH_A = 'TEST-BRANCH-A'
const BRANCH_B = 'TEST-BRANCH-B'
const PRODUCT_ID = 'TEST-BRANCH-PRODUCT'
let sessionToken = ''
let branchPassword = { salt: '', hash: '' }

async function insertBranch(id: string): Promise<void> {
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO users (
      id, branch_code, branch_name, username, role, password_salt, password_hash,
      active, session_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'branch', ?, ?, 1, 1, ?, ?)`,
  ).bind(
    id,
    `JIB-${id}`,
    `Branch ${id}`,
    id.toLowerCase(),
    branchPassword.salt,
    branchPassword.hash,
    now,
    now,
  ).run()
}

async function insertReservation(branchId: string): Promise<void> {
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO products (id, sku, name, price, total_stock, remaining_stock, active, created_at, updated_at)
     VALUES (?, ?, 'Branch Delete Product', 1000, 2, 2, 1, ?, ?)`,
  ).bind(PRODUCT_ID, PRODUCT_ID, now, now).run()
  await env.DB.prepare(
    `INSERT INTO reservations (
      id, product_id, branch_id, customer_name, customer_phone, status,
      created_at, expires_at, updated_at, idempotency_key
    ) VALUES (?, ?, ?, 'Branch Delete Test', '0812345678', 'Waiting for Approved', ?, ?, ?, ?)`,
  ).bind(
    `RES-${branchId}`,
    PRODUCT_ID,
    branchId,
    now,
    now + 72 * 60 * 60 * 1000,
    now,
    `KEY-${branchId}`,
  ).run()
}

async function deleteRequest(body: Record<string, unknown>): Promise<Response> {
  return worker.fetch(new Request('https://example.com/api/v1/admin/branches/delete', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: `${SESSION_COOKIE}=${sessionToken}`,
      origin: 'https://example.com',
    },
    body: JSON.stringify(body),
  }), env)
}

beforeAll(async () => {
  const adminPassword = await hashPassword(ADMIN_PASSWORD)
  branchPassword = await hashPassword('1234')
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO users (
      id, branch_name, username, role, password_salt, password_hash,
      active, session_version, created_at, updated_at
    ) VALUES (?, 'Test Admin', ?, 'admin', ?, ?, 1, 1, ?, ?)`,
  ).bind(ADMIN_ID, ADMIN_ID, adminPassword.salt, adminPassword.hash, now, now).run()
  sessionToken = (await login(env, ADMIN_ID, ADMIN_PASSWORD, 'admin', now)).token
})

afterEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reservations WHERE branch_id IN (?, ?)').bind(BRANCH_A, BRANCH_B),
    env.DB.prepare('DELETE FROM users WHERE id IN (?, ?)').bind(BRANCH_A, BRANCH_B),
    env.DB.prepare('DELETE FROM products WHERE id = ?').bind(PRODUCT_ID),
  ])
})

describe.sequential('admin branch deletion', () => {
  it('deletes a selected branch and its active sessions when it has no reservation history', async () => {
    await insertBranch(BRANCH_A)
    const now = Date.now()
    await env.DB.prepare(
      `INSERT INTO sessions (token_hash, user_id, session_version, expires_at, created_at)
       VALUES ('test-branch-session', ?, 1, ?, ?)`,
    ).bind(BRANCH_A, now + 60_000, now).run()

    const response = await deleteRequest({ scope: 'selected', branchIds: [BRANCH_A] })
    const result = await response.json() as { count: number }

    expect(response.status).toBe(200)
    expect(result.count).toBe(1)
    expect(await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(BRANCH_A).first()).toBeNull()
    expect(await env.DB.prepare('SELECT token_hash FROM sessions WHERE user_id = ?').bind(BRANCH_A).first()).toBeNull()
  })

  it('blocks the whole selected batch when one branch has reservation history', async () => {
    await insertBranch(BRANCH_A)
    await insertBranch(BRANCH_B)
    await insertReservation(BRANCH_B)

    const response = await deleteRequest({ scope: 'selected', branchIds: [BRANCH_A, BRANCH_B] })
    const result = await response.json() as { code: string }
    const remaining = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM users WHERE id IN (?, ?)',
    ).bind(BRANCH_A, BRANCH_B).first<{ count: number }>()

    expect(response.status).toBe(409)
    expect(result.code).toBe('BRANCH_IN_USE')
    expect(remaining?.count).toBe(2)
  })

  it('blocks delete all when any branch has reservation history', async () => {
    await insertBranch(BRANCH_B)
    await insertReservation(BRANCH_B)

    const response = await deleteRequest({ scope: 'all' })
    const result = await response.json() as { code: string }

    expect(response.status).toBe(409)
    expect(result.code).toBe('BRANCH_IN_USE')
  })
})
