import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import worker from './index'

const ORIGIN = 'https://example.com'

async function login(): Promise<string> {
  const response = await worker.fetch(new Request(`${ORIGIN}/api/v1/auth/login`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: 'jib284', password: '1234', role: 'branch' }),
  }), env)
  expect(response.status).toBe(200)
  const cookie = response.headers.get('set-cookie')
  if (!cookie) throw new Error('Login did not return a session cookie')
  return cookie.split(';', 1)[0]
}

async function currentSession(cookie: string): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}/api/v1/auth/session`, { headers: { cookie } }), env)
}

afterEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE user_id = '284'"),
    env.DB.prepare("UPDATE users SET active_session_token_hash = NULL WHERE id = '284'"),
  ])
})

describe.sequential('single active session', () => {
  it('invalidates the earlier device when the same account logs in again', async () => {
    const firstDevice = await login()
    expect((await currentSession(firstDevice)).status).toBe(200)

    const secondDevice = await login()
    const firstResponse = await currentSession(firstDevice)
    expect(firstResponse.status).toBe(401)
    expect(await firstResponse.json()).toMatchObject({ code: 'SESSION_REPLACED' })
    expect((await currentSession(secondDevice)).status).toBe(200)
  })
})
