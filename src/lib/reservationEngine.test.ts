import { describe, expect, it } from 'vitest'
import { createSeedState } from '../data/seed'
import {
  AtomicReservationStore,
  cancelReservation,
  expireMissingReceipts,
  reserveOne,
} from './reservationEngine'

const input = (key: string) => ({
  productId: 'MFYW4ZP/A',
  branchId: '284',
  customerName: 'สมชาย ทดสอบ',
  customerPhone: '0812345678',
  idempotencyKey: key,
})

describe('reservation stock safeguards', () => {
  it('accepts only 5 of 20 simultaneous requests for stock 5', async () => {
    const state = createSeedState()
    const store = new AtomicReservationStore(state)
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => store.reserve(input(`key-${index}`))),
    )

    expect(results.filter((result) => result.ok)).toHaveLength(5)
    expect(results.filter((result) => !result.ok && result.code === 'SOLD_OUT')).toHaveLength(15)
    expect(store.snapshot().products[0].remainingStock).toBe(0)
    expect(store.snapshot().reservations).toHaveLength(5)
  })

  it('replays an idempotent submit without decrementing stock twice', () => {
    const state = createSeedState()
    const first = reserveOne(state, input('same-key'))
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = reserveOne(first.state, input('same-key'))
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.replayed).toBe(true)
    expect(second.state.products[0].remainingStock).toBe(4)
    expect(second.state.reservations).toHaveLength(1)
  })

  it('restores stock exactly once on cancel', () => {
    const first = reserveOne(createSeedState(), input('cancel-key'))
    if (!first.ok) throw new Error('setup failed')
    const cancelled = cancelReservation(first.state, first.reservation.id, 'สาขายกเลิก')
    const cancelledAgain = cancelReservation(cancelled, first.reservation.id, 'สาขายกเลิก')

    expect(cancelledAgain.products[0].remainingStock).toBe(5)
    expect(cancelledAgain.reservations[0].status).toBe('Cancel')
  })

  it('expires a reservation without a receipt after 72 hours and restores stock', () => {
    const start = new Date('2026-01-01T00:00:00.000Z')
    const first = reserveOne(createSeedState(), input('expire-key'), start)
    if (!first.ok) throw new Error('setup failed')

    const expired = expireMissingReceipts(
      first.state,
      new Date('2026-01-04T00:00:01.000Z'),
    )
    expect(expired.products[0].remainingStock).toBe(5)
    expect(expired.reservations[0].status).toBe('Cancel')
  })
})
