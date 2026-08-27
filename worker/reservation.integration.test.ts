import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'

const PRODUCT_ID = 'MFYW4ZP/A'
const BRANCH_ID = '284'

async function resetProduct(stock = 5): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reservations WHERE product_id = ?').bind(PRODUCT_ID),
    env.DB.prepare('UPDATE products SET total_stock = ?, remaining_stock = ? WHERE id = ?').bind(stock, stock, PRODUCT_ID),
  ])
}

function insertReservation(index: number, idempotencyKey: string): Promise<D1Result> {
  const now = Date.now()
  return env.DB.prepare(
    `INSERT INTO reservations (
      id, product_id, branch_id, customer_name, customer_phone, status,
      created_at, expires_at, updated_at, idempotency_key
    ) VALUES (?, ?, ?, ?, ?, 'Waiting for Approved', ?, ?, ?, ?)`,
  ).bind(
    `TEST-${idempotencyKey}-${index}`,
    PRODUCT_ID,
    BRANCH_ID,
    `Customer ${index}`,
    '0812345678',
    now,
    now + 72 * 60 * 60 * 1000,
    now,
    idempotencyKey,
  ).run()
}

describe('database stock safeguards', () => {
  it('accepts exactly 5 of 20 simultaneous reservations when stock is 5', async () => {
    await resetProduct(5)
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) => insertReservation(index, `load-${index}`)),
    )

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(5)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(15)
    const product = await env.DB.prepare(
      'SELECT remaining_stock FROM products WHERE id = ?',
    ).bind(PRODUCT_ID).first<{ remaining_stock: number }>()
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM reservations
       WHERE product_id = ? AND status <> 'Cancel'`,
    ).bind(PRODUCT_ID).first<{ count: number }>()
    expect(product?.remaining_stock).toBe(0)
    expect(count?.count).toBe(5)
  })

  it('enforces one row for repeated submissions and restores stock once on cancel', async () => {
    await resetProduct(5)
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) => insertReservation(index, 'same-key')),
    )
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)

    const reservation = await env.DB.prepare(
      'SELECT id FROM reservations WHERE product_id = ? AND idempotency_key = ?',
    ).bind(PRODUCT_ID, 'same-key').first<{ id: string }>()
    expect(reservation).not.toBeNull()
    const now = Date.now()
    await env.DB.prepare(
      `UPDATE reservations SET status = 'Cancel', updated_at = ?
       WHERE id = ?`,
    ).bind(now, reservation?.id).run()
    await env.DB.prepare(
      `UPDATE reservations SET status = 'Cancel', updated_at = ?
       WHERE id = ?`,
    ).bind(now + 1, reservation?.id).run()

    const product = await env.DB.prepare(
      'SELECT remaining_stock FROM products WHERE id = ?',
    ).bind(PRODUCT_ID).first<{ remaining_stock: number }>()
    expect(product?.remaining_stock).toBe(5)
  })
})
