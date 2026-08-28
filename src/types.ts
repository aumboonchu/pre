export type ReservationStatus = 'Waiting for Approved' | 'Confirmed' | 'Cancel'

export interface Product {
  id: string
  sku: string
  name: string
  price: number
  totalStock: number
  remainingStock: number
  active: boolean
}

export interface BranchUser {
  id: string
  code: string
  name: string
  username: string
  password: string
  active: boolean
}

export type BranchDirectoryEntry = Pick<BranchUser, 'id' | 'code' | 'name' | 'username'>

export interface Receipt {
  name: string
  type: string
  dataUrl: string
  uploadedAt: string
}

export interface Reservation {
  id: string
  productId: string
  branchId: string
  customerName: string
  customerPhone: string
  status: ReservationStatus
  receipt?: Receipt
  createdAt: string
  expiresAt: string
  updatedAt: string
  idempotencyKey: string
  cancelReason?: string
}

export interface AppState {
  schemaVersion: number
  products: Product[]
  branches: BranchUser[]
  reservations: Reservation[]
  admin: {
    username: string
    password: string
  }
  settings: {
    bookingOpen: boolean
    opensAtLabel: string
  }
}

export interface ReservationInput {
  productId: string
  branchId: string
  customerName: string
  customerPhone: string
  idempotencyKey: string
  receipt?: Receipt
}

export type ReservationErrorCode =
  | 'SOLD_OUT'
  | 'BOOKING_CLOSED'
  | 'PRODUCT_NOT_FOUND'
  | 'DUPLICATE'

export type ReservationResult =
  | { ok: true; state: AppState; reservation: Reservation; replayed: boolean }
  | { ok: false; state: AppState; code: ReservationErrorCode; message: string }

export type Session =
  | { role: 'branch'; branchId: string }
  | { role: 'admin' }
  | null
