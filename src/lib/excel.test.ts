import { describe, expect, it } from 'vitest'
import { createSeedState } from '../data/seed'
import type { Reservation } from '../types'
import { buildReservationExportRows } from './excel'

describe('reservation Excel export', () => {
  it('exports typed reservation data without receipt image or URL', () => {
    const state = createSeedState()
    const reservation: Reservation = {
      id: 'PRE-TEST-001',
      productId: state.products[0].id,
      branchId: state.branches[0].id,
      customerName: 'ลูกค้า ทดสอบ',
      customerPhone: '0812345678',
      status: 'Waiting for Approved',
      receipt: {
        name: 'receipt.jpg',
        type: 'image/jpeg',
        dataUrl: '/api/v1/reservations/PRE-TEST-001/receipt',
        uploadedAt: '2026-08-29T02:00:00.000Z',
      },
      createdAt: '2026-08-29T01:00:00.000Z',
      expiresAt: '2026-09-01T01:00:00.000Z',
      updatedAt: '2026-08-29T02:00:00.000Z',
      idempotencyKey: 'test-export-key',
    }

    const [row] = buildReservationExportRows([reservation], state.products, state.branches)

    expect(row['เลขที่การจอง']).toBe('PRE-TEST-001')
    expect(row['ราคา (บาท)']).toBe(state.products[0].price)
    expect(row['วันที่จอง']).toBeInstanceOf(Date)
    expect(row['สถานะใบเสร็จ']).toBe('แนบแล้ว')
    expect(JSON.stringify(row)).not.toContain('receipt.jpg')
    expect(JSON.stringify(row)).not.toContain('/api/v1/reservations/')
  })
})
