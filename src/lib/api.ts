import type { AppState, BranchUser, Product, Receipt, ReservationInput, Session } from '../types'

interface ApiEnvelope {
  ok: boolean
  code?: string
  message?: string
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function request<T extends ApiEnvelope>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  let data: T
  try {
    data = await response.json() as T
  } catch {
    throw new ApiError(response.status, 'INVALID_RESPONSE', 'Server ส่งข้อมูลกลับมาไม่ถูกต้อง')
  }
  if (!response.ok || !data.ok) {
    throw new ApiError(response.status, data.code ?? 'REQUEST_FAILED', data.message ?? 'ดำเนินการไม่สำเร็จ')
  }
  return data
}

function receiptFile(receipt: Receipt): File {
  const separator = receipt.dataUrl.indexOf(',')
  if (separator < 0) throw new Error('ข้อมูลรูปใบเสร็จไม่ถูกต้อง')
  const binary = atob(receipt.dataUrl.slice(separator + 1))
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new File([bytes], receipt.name, { type: receipt.type })
}

export const api = {
  async login(identifier: string, password: string, role: 'branch' | 'admin'): Promise<Session> {
    const result = await request<ApiEnvelope & { session: Session }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password, role }),
    })
    return result.session
  },

  async session(): Promise<Session> {
    const result = await request<ApiEnvelope & { session: Session }>('/api/v1/auth/session')
    return result.session
  },

  async logout(): Promise<void> {
    await request('/api/v1/auth/logout', { method: 'POST' })
  },

  async state(): Promise<AppState> {
    const result = await request<ApiEnvelope & { state: AppState }>('/api/v1/state')
    return result.state
  },

  async reserve(input: ReservationInput): Promise<{ reservationId: string; replayed: boolean }> {
    const result = await request<ApiEnvelope & { reservationId: string; replayed: boolean }>(
      '/api/v1/reservations',
      {
        method: 'POST',
        headers: { 'idempotency-key': input.idempotencyKey },
        body: JSON.stringify({
          productId: input.productId,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          idempotencyKey: input.idempotencyKey,
        }),
      },
    )
    return { reservationId: result.reservationId, replayed: result.replayed }
  },

  async cancel(reservationId: string, reason: string): Promise<void> {
    await request(`/api/v1/reservations/${encodeURIComponent(reservationId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    })
  },

  async uploadReceipt(reservationId: string, receipt: Receipt): Promise<void> {
    const form = new FormData()
    form.set('receipt', receiptFile(receipt))
    await request(`/api/v1/reservations/${encodeURIComponent(reservationId)}/receipt`, {
      method: 'POST',
      body: form,
    })
  },

  async setReservationStatus(reservationId: string, status: 'Confirmed' | 'Cancel'): Promise<void> {
    await request(`/api/v1/admin/reservations/${encodeURIComponent(reservationId)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    })
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await request('/api/v1/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    })
  },

  async upsertProduct(product: Product): Promise<void> {
    await request(`/api/v1/admin/products/${encodeURIComponent(product.id)}`, {
      method: 'PUT',
      body: JSON.stringify(product),
    })
  },

  async importProducts(products: Product[]): Promise<void> {
    await request('/api/v1/admin/products/import', {
      method: 'POST',
      body: JSON.stringify({ products }),
    })
  },

  async deleteProducts(productIds?: string[]): Promise<number> {
    const result = await request<ApiEnvelope & { count: number }>('/api/v1/admin/products/delete', {
      method: 'POST',
      body: JSON.stringify(productIds ? { scope: 'selected', productIds } : { scope: 'all' }),
    })
    return result.count
  },

  async upsertBranch(branch: BranchUser): Promise<void> {
    await request(`/api/v1/admin/branches/${encodeURIComponent(branch.id)}`, {
      method: 'PUT',
      body: JSON.stringify(branch),
    })
  },

  async importBranches(branches: BranchUser[]): Promise<void> {
    await request('/api/v1/admin/branches/import', {
      method: 'POST',
      body: JSON.stringify({ branches }),
    })
  },

  async resetBranchPassword(branchId: string): Promise<void> {
    await request(`/api/v1/admin/branches/${encodeURIComponent(branchId)}/reset-password`, {
      method: 'POST',
    })
  },

  async setBookingOpen(bookingOpen: boolean): Promise<void> {
    await request('/api/v1/admin/settings/booking', {
      method: 'POST',
      body: JSON.stringify({ bookingOpen }),
    })
  },
}
