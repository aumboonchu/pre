import type {
  AppState,
  Receipt,
  Reservation,
  ReservationInput,
  ReservationResult,
} from '../types'

const HOURS_72 = 72 * 60 * 60 * 1000

const reservationId = (now: Date) => {
  const stamp = now.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)
  const random = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `RES-${stamp}-${random}`
}

export function reserveOne(
  state: AppState,
  input: ReservationInput,
  now = new Date(),
): ReservationResult {
  const replay = state.reservations.find(
    (reservation) => reservation.idempotencyKey === input.idempotencyKey,
  )

  if (replay) {
    return { ok: true, state, reservation: replay, replayed: true }
  }

  if (!state.settings.bookingOpen) {
    return {
      ok: false,
      state,
      code: 'BOOKING_CLOSED',
      message: `ระบบยังไม่เปิดรับจอง โปรดลองอีกครั้งหลัง ${state.settings.opensAtLabel}`,
    }
  }

  const productIndex = state.products.findIndex(
    (product) => product.id === input.productId && product.active,
  )
  if (productIndex < 0) {
    return {
      ok: false,
      state,
      code: 'PRODUCT_NOT_FOUND',
      message: 'ไม่พบสินค้าหรือสินค้าถูกปิดรับจองแล้ว',
    }
  }

  const product = state.products[productIndex]
  if (product.remainingStock <= 0) {
    return {
      ok: false,
      state,
      code: 'SOLD_OUT',
      message: 'สินค้าหมดระหว่างดำเนินการ ระบบไม่ได้สร้างรายการจอง',
    }
  }

  const timestamp = now.toISOString()
  const reservation: Reservation = {
    id: reservationId(now),
    productId: input.productId,
    branchId: input.branchId,
    customerName: input.customerName.trim(),
    customerPhone: input.customerPhone.trim(),
    status: 'Waiting for Approved',
    receipt: input.receipt,
    createdAt: timestamp,
    updatedAt: timestamp,
    expiresAt: new Date(now.getTime() + HOURS_72).toISOString(),
    idempotencyKey: input.idempotencyKey,
  }

  const products = state.products.map((item, index) =>
    index === productIndex
      ? { ...item, remainingStock: item.remainingStock - 1 }
      : item,
  )

  return {
    ok: true,
    replayed: false,
    reservation,
    state: { ...state, products, reservations: [reservation, ...state.reservations] },
  }
}

export function cancelReservation(
  state: AppState,
  reservationIdToCancel: string,
  reason: string,
  now = new Date(),
): AppState {
  const target = state.reservations.find(
    (reservation) => reservation.id === reservationIdToCancel,
  )
  if (!target || target.status === 'Cancel') return state

  return {
    ...state,
    products: state.products.map((product) =>
      product.id === target.productId
        ? {
            ...product,
            remainingStock: Math.min(product.totalStock, product.remainingStock + 1),
          }
        : product,
    ),
    reservations: state.reservations.map((reservation) =>
      reservation.id === reservationIdToCancel
        ? {
            ...reservation,
            status: 'Cancel',
            cancelReason: reason,
            updatedAt: now.toISOString(),
          }
        : reservation,
    ),
  }
}

export function expireMissingReceipts(state: AppState, now = new Date()): AppState {
  return state.reservations.reduce((next, reservation) => {
    const shouldExpire =
      reservation.status === 'Waiting for Approved' &&
      !reservation.receipt &&
      new Date(reservation.expiresAt).getTime() <= now.getTime()
    return shouldExpire
      ? cancelReservation(next, reservation.id, 'หมดสิทธิ์: ไม่มีใบเสร็จภายใน 72 ชั่วโมง', now)
      : next
  }, state)
}

export function attachReceipt(
  state: AppState,
  reservationIdToUpdate: string,
  receipt: Receipt,
): AppState {
  return {
    ...state,
    reservations: state.reservations.map((reservation) =>
      reservation.id === reservationIdToUpdate && reservation.status !== 'Cancel'
        ? { ...reservation, receipt, updatedAt: receipt.uploadedAt }
        : reservation,
    ),
  }
}

export function confirmReservation(
  state: AppState,
  reservationIdToConfirm: string,
  now = new Date(),
): AppState {
  return {
    ...state,
    reservations: state.reservations.map((reservation) =>
      reservation.id === reservationIdToConfirm && reservation.status !== 'Cancel'
        ? { ...reservation, status: 'Confirmed', updatedAt: now.toISOString() }
        : reservation,
    ),
  }
}

export class AtomicReservationStore {
  private current: AppState
  private queue: Promise<void> = Promise.resolve()

  constructor(initialState: AppState) {
    this.current = structuredClone(initialState)
  }

  reserve(input: ReservationInput, now = new Date()): Promise<ReservationResult> {
    let resolveResult: (value: ReservationResult) => void
    const result = new Promise<ReservationResult>((resolve) => {
      resolveResult = resolve
    })

    this.queue = this.queue.then(() => {
      const attempt = reserveOne(this.current, input, now)
      if (attempt.ok) this.current = attempt.state
      resolveResult(attempt)
    })

    return result
  }

  snapshot() {
    return structuredClone(this.current)
  }
}
