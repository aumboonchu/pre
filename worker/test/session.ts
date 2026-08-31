import { env } from 'cloudflare:workers'
import { SESSION_COOKIE } from '../auth'

const encoder = new TextEncoder()

async function tokenHash(token: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token)))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sessionCookieFor(userId: string): Promise<string> {
  const token = `test-${userId}-${crypto.randomUUID()}`
  const hash = await tokenHash(token)
  const user = await env.DB.prepare(
    'SELECT session_version FROM users WHERE id = ?',
  ).bind(userId).first<{ session_version: number }>()
  if (!user) throw new Error(`Missing test user ${userId}`)
  const now = Date.now()
  await env.DB.prepare(
    'UPDATE users SET active_session_token_hash = ? WHERE id = ?',
  ).bind(hash, userId).run()
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, session_version, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(hash, userId, user.session_version, now + 60_000, now).run()
  return `${SESSION_COOKIE}=${token}`
}
