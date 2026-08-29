import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it } from 'vitest'
import worker from './index'
import { sessionCookieFor } from './test/session'

const PRODUCT_ID = 'test-booking-schedule-product'
const ORIGIN = 'https://example.com'

async function configure(cookie: string, body: Record<string, unknown>): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}/api/v1/admin/settings/booking`, {
    method: 'POST',
    headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), env)
}

async function reserve(cookie: string, key: string): Promise<Response> {
  return worker.fetch(new Request(`${ORIGIN}/api/v1/reservations`, {
    method: 'POST',
    headers: {
      cookie,
      origin: ORIGIN,
      'content-type': 'application/json',
      'idempotency-key': key,
    },
    body: JSON.stringify({
      productId: PRODUCT_ID,
      customerName: 'Schedule Test',
      customerPhone: '0812345678',
      idempotencyKey: key,
    }),
  }), env)
}

afterEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reservations WHERE product_id = ?').bind(PRODUCT_ID),
    env.DB.prepare('DELETE FROM products WHERE id = ?').bind(PRODUCT_ID),
    env.DB.prepare("UPDATE settings SET value = '0' WHERE key = 'booking_open'"),
    env.DB.prepare("UPDATE settings SET value = '' WHERE key IN ('booking_opens_at', 'booking_closes_at')"),
    env.DB.prepare("DELETE FROM sessions WHERE user_id IN ('admin', '284')"),
  ])
})

describe.sequential('booking schedule', () => {
  it('enforces opening and closing times on the server', async () => {
    const now = Date.now()
    const adminCookie = await sessionCookieFor('admin')
    const branchCookie = await sessionCookieFor('284')
    await env.DB.prepare(
      `INSERT INTO products (id, sku, name, price, total_stock, remaining_stock, active, created_at, updated_at)
       VALUES (?, ?, 'Schedule Product', 1000, 3, 3, 1, ?, ?)`,
    ).bind(PRODUCT_ID, PRODUCT_ID, now, now).run()

    expect((await configure(adminCookie, {
      bookingEnabled: true,
      opensAt: new Date(now + 60_000).toISOString(),
      closesAt: new Date(now + 120_000).toISOString(),
    })).status).toBe(200)
    const beforeOpen = await reserve(branchCookie, 'schedule-before-open')
    expect(beforeOpen.status).toBe(409)
    expect((await beforeOpen.json() as { code: string }).code).toBe('BOOKING_CLOSED')

    expect((await configure(adminCookie, {
      bookingEnabled: true,
      opensAt: new Date(now - 60_000).toISOString(),
      closesAt: new Date(now + 60_000).toISOString(),
    })).status).toBe(200)
    expect((await reserve(branchCookie, 'schedule-open')).status).toBe(201)

    expect((await configure(adminCookie, {
      bookingEnabled: true,
      opensAt: new Date(now - 120_000).toISOString(),
      closesAt: new Date(now - 60_000).toISOString(),
    })).status).toBe(200)
    const afterClose = await reserve(branchCookie, 'schedule-after-close')
    expect(afterClose.status).toBe(409)
    expect((await afterClose.json() as { code: string }).code).toBe('BOOKING_CLOSED')
  })

  it('returns the effective window and rejects an invalid range', async () => {
    const now = Date.now()
    const adminCookie = await sessionCookieFor('admin')
    const opensAt = new Date(now + 60_000).toISOString()
    const closesAt = new Date(now + 120_000).toISOString()
    expect((await configure(adminCookie, { bookingEnabled: true, opensAt, closesAt })).status).toBe(200)

    const stateResponse = await worker.fetch(new Request(`${ORIGIN}/api/v1/state`, {
      headers: { cookie: adminCookie },
    }), env)
    const payload = await stateResponse.json() as {
      state: { settings: { bookingEnabled: boolean; bookingOpen: boolean; opensAt: string; closesAt: string; timeZone: string } }
    }
    expect(payload.state.settings).toMatchObject({
      bookingEnabled: true,
      bookingOpen: false,
      opensAt,
      closesAt,
      timeZone: 'Asia/Bangkok',
    })

    const invalid = await configure(adminCookie, {
      bookingEnabled: true,
      opensAt: closesAt,
      closesAt: opensAt,
    })
    expect(invalid.status).toBe(400)
    expect((await invalid.json() as { code: string }).code).toBe('INVALID_BOOKING_WINDOW')
  })
})
