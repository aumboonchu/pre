import { env } from 'cloudflare:workers'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import worker from './index'
import { hashPassword, login, SESSION_COOKIE } from './auth'

const ADMIN_ID = 'test-product-delete-admin'
const ADMIN_PASSWORD = 'test-password-9876'
const PRODUCT_A = 'TEST-DELETE-A'
const PRODUCT_B = 'TEST-DELETE-B'
const RECEIPT_KEY = 'receipts/TEST-DELETE-B/test.png'
let sessionToken = ''

async function insertProduct(id: string): Promise<void> {
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO products (id, sku, name, price, total_stock, remaining_stock, active, created_at, updated_at)
     VALUES (?, ?, ?, 1000, 2, 2, 1, ?, ?)`,
  ).bind(id, id, `Product ${id}`, now, now).run()
}

async function insertReservation(productId: string, receiptKey: string | null = null): Promise<void> {
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO reservations (
      id, product_id, branch_id, customer_name, customer_phone, status, receipt_key,
      created_at, expires_at, updated_at, idempotency_key
    ) VALUES (?, ?, '284', 'Delete Test', '0812345678', 'Waiting for Approved', ?, ?, ?, ?, ?)`,
  ).bind(
    `RES-${productId}`,
    productId,
    receiptKey,
    now,
    now + 72 * 60 * 60 * 1000,
    now,
    `KEY-${productId}`,
  ).run()
}

async function deleteRequest(body: Record<string, unknown>): Promise<Response> {
  return worker.fetch(new Request('https://example.com/api/v1/admin/products/delete', {
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
  const password = await hashPassword(ADMIN_PASSWORD)
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO users (
      id, branch_name, username, role, password_salt, password_hash,
      active, session_version, created_at, updated_at
    ) VALUES (?, 'Test Admin', ?, 'admin', ?, ?, 1, 1, ?, ?)`,
  ).bind(ADMIN_ID, ADMIN_ID, password.salt, password.hash, now, now).run()
  sessionToken = (await login(env, ADMIN_ID, ADMIN_PASSWORD, 'admin', now)).token
})

afterEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reservations WHERE product_id IN (?, ?)').bind(PRODUCT_A, PRODUCT_B),
    env.DB.prepare('DELETE FROM products WHERE id IN (?, ?)').bind(PRODUCT_A, PRODUCT_B),
  ])
  await env.RECEIPTS.delete(RECEIPT_KEY)
})

describe.sequential('admin product deletion', () => {
  it('deletes selected products that have no reservation history', async () => {
    await insertProduct(PRODUCT_A)

    const response = await deleteRequest({ scope: 'selected', productIds: [PRODUCT_A] })
    const result = await response.json() as { count: number }

    expect(response.status).toBe(200)
    expect(result.count).toBe(1)
    expect(await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(PRODUCT_A).first()).toBeNull()
  })

  it('deletes products together with their reservation history and receipt', async () => {
    await insertProduct(PRODUCT_A)
    await insertProduct(PRODUCT_B)
    await env.RECEIPTS.put(RECEIPT_KEY, new Uint8Array([1, 2, 3]))
    await insertReservation(PRODUCT_B, RECEIPT_KEY)

    const response = await deleteRequest({ scope: 'selected', productIds: [PRODUCT_A, PRODUCT_B] })
    const result = await response.json() as { count: number; reservationCount: number }
    const remaining = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM products WHERE id IN (?, ?)',
    ).bind(PRODUCT_A, PRODUCT_B).first<{ count: number }>()
    const reservation = await env.DB.prepare(
      'SELECT id FROM reservations WHERE product_id = ?',
    ).bind(PRODUCT_B).first()

    expect(response.status).toBe(200)
    expect(result.count).toBe(2)
    expect(result.reservationCount).toBe(1)
    expect(remaining?.count).toBe(0)
    expect(reservation).toBeNull()
    expect(await env.RECEIPTS.get(RECEIPT_KEY)).toBeNull()
  })
})
