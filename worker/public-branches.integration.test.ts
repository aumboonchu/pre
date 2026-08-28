import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import worker from './index'

const ACTIVE_ID = 'test-public-active'
const INACTIVE_ID = 'test-public-inactive'

async function insertBranch(id: string, active: boolean): Promise<void> {
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO users (
      id, branch_code, branch_name, username, role, password_salt, password_hash,
      active, session_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'branch', 'test-salt', 'test-hash', ?, 1, ?, ?)`,
  ).bind(
    id,
    `JIB-${id}`,
    `Branch ${id}`,
    `user-${id}`,
    active ? 1 : 0,
    now,
    now,
  ).run()
}

async function getDirectory(): Promise<Response> {
  return worker.fetch(
    new Request('https://example.com/api/v1/public/branches'),
    env,
  )
}

afterEach(async () => {
  await env.DB.prepare('DELETE FROM users WHERE id IN (?, ?)').bind(ACTIVE_ID, INACTIVE_ID).run()
})

describe.sequential('public branch directory', () => {
  it('returns current active branches without credentials or password fields', async () => {
    await insertBranch(ACTIVE_ID, true)
    await insertBranch(INACTIVE_ID, false)

    const response = await getDirectory()
    const result = await response.json() as {
      branches: Array<Record<string, unknown>>
    }
    const active = result.branches.find((branch) => branch.id === ACTIVE_ID)

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(active).toEqual({
      id: ACTIVE_ID,
      code: `JIB-${ACTIVE_ID}`,
      name: `Branch ${ACTIVE_ID}`,
      username: `user-${ACTIVE_ID}`,
    })
    expect(result.branches.some((branch) => branch.id === INACTIVE_ID)).toBe(false)
    expect(active).not.toHaveProperty('password_hash')
    expect(active).not.toHaveProperty('password_salt')
  })

  it('returns admin edits on the next request', async () => {
    await insertBranch(ACTIVE_ID, true)
    await env.DB.prepare(
      'UPDATE users SET branch_name = ?, username = ? WHERE id = ?',
    ).bind('Updated Branch Name', 'updated-username', ACTIVE_ID).run()

    const response = await getDirectory()
    const result = await response.json() as {
      branches: Array<{ id: string; name: string; username: string }>
    }
    const updated = result.branches.find((branch) => branch.id === ACTIVE_ID)

    expect(updated?.name).toBe('Updated Branch Name')
    expect(updated?.username).toBe('updated-username')
  })
})
