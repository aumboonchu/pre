import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import worker from './index'
import { sessionCookieFor } from './test/session'

const RESERVATION_ID = 'test-private-receipt'
const RECEIPT_KEY = `receipts/${RESERVATION_ID}/receipt.jpg`
const ORIGIN = 'https://example.com'

beforeEach(async () => {
  const now = Date.now()
  await env.DB.prepare(
    `INSERT INTO reservations (
      id, product_id, branch_id, customer_name, customer_phone, status,
      receipt_key, receipt_name, receipt_type, receipt_uploaded_at,
      created_at, expires_at, updated_at, idempotency_key
    ) VALUES (?, 'MFYW4ZP/A', '284', 'Receipt Test', '0812345678', 'Cancel', ?, 'receipt.jpg', 'image/jpeg', ?, ?, ?, ?, ?)`,
  ).bind(RESERVATION_ID, RECEIPT_KEY, now, now, now + 60_000, now, 'test-private-receipt-key').run()
  await env.RECEIPTS.put(RECEIPT_KEY, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))
})

afterEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reservations WHERE id = ?').bind(RESERVATION_ID),
    env.DB.prepare("DELETE FROM sessions WHERE user_id IN ('admin', '284', '286')"),
  ])
  await env.RECEIPTS.delete(RECEIPT_KEY)
})

async function view(cookie?: string): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}/api/v1/reservations/${RESERVATION_ID}/receipt`, {
    headers: cookie ? { cookie } : {},
  }), env)
}

describe.sequential('receipt access', () => {
  it('allows only admin or the owning branch and prevents caching', async () => {
    const adminCookie = await sessionCookieFor('admin')
    const ownerCookie = await sessionCookieFor('284')
    const otherCookie = await sessionCookieFor('286')

    const adminResponse = await view(adminCookie)
    expect(adminResponse.status).toBe(200)
    expect(adminResponse.headers.get('cache-control')).toBe('private, no-store')
    expect(adminResponse.headers.get('x-content-type-options')).toBe('nosniff')
    expect((await view(ownerCookie)).status).toBe(200)
    expect((await view(otherCookie)).status).toBe(404)
    expect((await view()).status).toBe(401)
  })
})
