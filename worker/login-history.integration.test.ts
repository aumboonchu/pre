import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import worker from './index'
import { sessionCookieFor } from './test/session'

const ORIGIN = 'https://example.com'

async function branchLogin(): Promise<string> {
  const response = await worker.fetch(new Request(`${ORIGIN}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      origin: ORIGIN,
      'content-type': 'application/json',
      'cf-connecting-ip': '203.0.113.55',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0.0.0 Safari/537.36',
    },
    body: JSON.stringify({ identifier: 'jib284', password: '1234', role: 'branch' }),
  }), env)
  expect(response.status).toBe(200)
  const cookie = response.headers.get('set-cookie')
  if (!cookie) throw new Error('Login did not return a session cookie')
  return cookie.split(';', 1)[0]
}

async function request(path: string, cookie: string, method = 'GET'): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}${path}`, {
    method,
    headers: { cookie, ...(method === 'POST' ? { origin: ORIGIN } : {}) },
  }), env)
}

afterEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id IN ('admin', '284')"),
    env.DB.prepare("DELETE FROM login_history WHERE user_id IN ('admin', '284')"),
    env.DB.prepare(
      `UPDATE users
       SET active_session_token_hash = NULL, last_login_at = NULL, last_seen_at = NULL, last_logout_at = NULL
       WHERE id IN ('admin', '284')`,
    ),
  ])
})

describe.sequential('branch login history', () => {
  it('keeps login details after the branch logs out', async () => {
    const branchCookie = await branchLogin()
    expect((await request('/api/v1/auth/logout', branchCookie, 'POST')).status).toBe(200)

    const adminCookie = await sessionCookieFor('admin')
    const response = await request('/api/v1/admin/branches/284/login-history', adminCookie)
    const body = await response.json() as {
      history: Array<{
        logoutAt: string | null
        ip: string
        device: string
        durationSeconds: number
      }>
    }
    expect(response.status).toBe(200)
    expect(body.history[0]).toMatchObject({
      ip: '203.0.113.55',
      device: 'Chrome · Windows',
    })
    expect(body.history[0]?.logoutAt).toEqual(expect.any(String))
    expect(body.history[0]?.durationSeconds).toBeGreaterThanOrEqual(0)
  })
})
