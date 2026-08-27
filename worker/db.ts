import type { AuthUser } from './auth'

interface ProductRow {
  id: string
  sku: string
  name: string
  price: number
  total_stock: number
  remaining_stock: number
  active: number
}

interface BranchRow {
  id: string
  branch_code: string
  branch_name: string
  username: string
  active: number
}

interface ReservationRow {
  id: string
  product_id: string
  branch_id: string
  customer_name: string
  customer_phone: string
  status: 'Waiting for Approved' | 'Confirmed' | 'Cancel'
  receipt_key: string | null
  receipt_name: string | null
  receipt_type: string | null
  receipt_uploaded_at: number | null
  created_at: number
  expires_at: number
  updated_at: number
  idempotency_key: string
  cancel_reason: string | null
}

interface SettingRow {
  key: string
  value: string
}

export async function expireReservations(env: Env, now: number): Promise<number> {
  const result = await env.DB.prepare(
    `UPDATE reservations
     SET status = 'Cancel', cancel_reason = 'ไม่มีใบเสร็จภายใน 72 ชั่วโมง', updated_at = ?
     WHERE status = 'Waiting for Approved' AND receipt_key IS NULL AND expires_at <= ?`,
  ).bind(now, now).run()
  return result.meta.changes
}

export async function getState(env: Env, user: AuthUser): Promise<Record<string, unknown>> {
  const branchQuery = user.role === 'admin'
    ? env.DB.prepare(
        `SELECT id, branch_code, branch_name, username, active
         FROM users WHERE role = 'branch' ORDER BY CAST(id AS INTEGER), id`,
      )
    : env.DB.prepare(
        `SELECT id, branch_code, branch_name, username, active
         FROM users WHERE id = ? AND role = 'branch'`,
      ).bind(user.id)
  const reservationQuery = user.role === 'admin'
    ? env.DB.prepare('SELECT * FROM reservations ORDER BY created_at DESC')
    : env.DB.prepare('SELECT * FROM reservations WHERE branch_id = ? ORDER BY created_at DESC').bind(user.id)

  const [productResult, branchResult, reservationResult, settingResult] = await Promise.all([
    env.DB.prepare('SELECT id, sku, name, price, total_stock, remaining_stock, active FROM products ORDER BY name').all<ProductRow>(),
    branchQuery.all<BranchRow>(),
    reservationQuery.all<ReservationRow>(),
    env.DB.prepare('SELECT key, value FROM settings').all<SettingRow>(),
  ])

  const settings = new Map(settingResult.results.map((row) => [row.key, row.value]))
  const bookingOpen = settings.get('booking_open') === '1'
  const opensAt = Number(settings.get('booking_opens_at') || 0)
  const effectiveOpen = bookingOpen && (!opensAt || opensAt <= Date.now())

  return {
    schemaVersion: 1,
    products: productResult.results.map((row) => ({
      id: row.id,
      sku: row.sku,
      name: row.name,
      price: row.price,
      totalStock: row.total_stock,
      remainingStock: row.remaining_stock,
      active: row.active === 1,
    })),
    branches: branchResult.results.map((row) => ({
      id: row.id,
      code: row.branch_code,
      name: row.branch_name,
      username: row.username,
      password: '',
      active: row.active === 1,
    })),
    reservations: reservationResult.results.map((row) => ({
      id: row.id,
      productId: row.product_id,
      branchId: row.branch_id,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      status: row.status,
      receipt: row.receipt_key
        ? {
            name: row.receipt_name ?? 'receipt',
            type: row.receipt_type ?? 'application/octet-stream',
            dataUrl: `/api/v1/reservations/${encodeURIComponent(row.id)}/receipt`,
            uploadedAt: new Date(row.receipt_uploaded_at ?? row.updated_at).toISOString(),
          }
        : undefined,
      createdAt: new Date(row.created_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      idempotencyKey: row.idempotency_key,
      cancelReason: row.cancel_reason ?? undefined,
    })),
    admin: { username: 'admin', password: '' },
    settings: {
      bookingOpen: effectiveOpen,
      opensAtLabel: settings.get('booking_label') ?? '20:00 น. (เวลา Server)',
    },
  }
}

export async function audit(
  env: Env,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  detail: Record<string, unknown> | null,
  now = Date.now(),
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_events (id, actor_id, action, entity_type, entity_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    actorId,
    action,
    entityType,
    entityId,
    detail ? JSON.stringify(detail) : null,
    now,
  ).run()
}
