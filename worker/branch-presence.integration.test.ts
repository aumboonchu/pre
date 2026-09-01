import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import worker from './index'
import { sessionCookieFor } from './test/session'

const ORIGIN = 'https://example.com'

async function request(path: string, cookie: string, method = 'GET'): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}${path}`, {
    method,
    headers: {
      cookie,
      ...(method === 'POST' ? { origin: ORIGIN } : {}),
    },
  }), env)
}

afterEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id IN ('admin', '284')"),
    env.DB.prepare(
      `UPDATE users
       SET active_session_token_hash = NULL, last_login_at = NULL, last_seen_at = NULL, last_logout_at = NULL
       WHERE id IN ('admin', '284')`,
    ),
  ])
})

describe.sequential('branch presence', () => {
  it('shows an active branch as online and records its logout time', async () => {
    const branchCookie = await sessionCookieFor('284')
    expect((await request('/api/v1/auth/heartbeat', branchCookie, 'POST')).status).toBe(200)

    const adminCookie = await sessionCookieFor('admin')
    const activeState = await request('/api/v1/state', adminCookie)
    const activeBody = await activeState.json() as {
      state: { branches: Array<{ id: string; online?: boolean; lastSeenAt?: string | null }> }
    }
    const activeBranch = activeBody.state.branches.find((branch) => branch.id === '284')
    expect(activeBranch).toMatchObject({ online: true })
    expect(activeBranch?.lastSeenAt).toEqual(expect.any(String))

    expect((await request('/api/v1/auth/logout', branchCookie, 'POST')).status).toBe(200)
    const offlineState = await request('/api/v1/state', adminCookie)
    const offlineBody = await offlineState.json() as {
      state: { branches: Array<{ id: string; online?: boolean; lastLogoutAt?: string | null }> }
    }
    const offlineBranch = offlineBody.state.branches.find((branch) => branch.id === '284')
    expect(offlineBranch).toMatchObject({ online: false })
    expect(offlineBranch?.lastLogoutAt).toEqual(expect.any(String))
  })
})
