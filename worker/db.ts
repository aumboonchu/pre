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

export interface BookingWindow {
  enabled: boolean
  open: boolean
  opensAt: number | null
  closesAt: number | null
  label: string
}

export interface AuditLocation {
  ipAddress: string | null
  province: string | null
}

function timestamp(value: string | undefined): number | null {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function bangkokDateTime(value: number): string {
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(value))
}

export function evaluateBookingWindow(
  settings: ReadonlyMap<string, string>,
  now: number,
): BookingWindow {
  const enabled = settings.get('booking_open') === '1'
  const opensAt = timestamp(settings.get('booking_opens_at'))
  const closesAt = timestamp(settings.get('booking_closes_at'))
  const open = enabled && (!opensAt || opensAt <= now) && (!closesAt || now < closesAt)

  let label = 'ปิดรับจองโดย Admin'
  if (enabled && opensAt && now < opensAt) label = `เปิด ${bangkokDateTime(opensAt)} น.`
  else if (enabled && closesAt && now >= closesAt) label = `สิ้นสุด ${bangkokDateTime(closesAt)} น.`
  else if (open && closesAt) label = `ปิด ${bangkokDateTime(closesAt)} น.`
  else if (open) label = 'เปิดรับจองทันที'

  return { enabled, open, opensAt, closesAt, label }
}

export async function getBookingWindow(env: Env, now: number): Promise<BookingWindow> {
  const result = await env.DB.prepare(
    `SELECT key, value FROM settings
     WHERE key IN ('booking_open', 'booking_opens_at', 'booking_closes_at')`,
  ).all<SettingRow>()
  return evaluateBookingWindow(new Map(result.results.map((row) => [row.key, row.value])), now)
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
  const bookingWindow = evaluateBookingWindow(settings, Date.now())

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
      bookingEnabled: bookingWindow.enabled,
      bookingOpen: bookingWindow.open,
      opensAt: bookingWindow.opensAt ? new Date(bookingWindow.opensAt).toISOString() : null,
      closesAt: bookingWindow.closesAt ? new Date(bookingWindow.closesAt).toISOString() : null,
      opensAtLabel: bookingWindow.label,
      timeZone: 'Asia/Bangkok',
    },
  }
}

export async function audit(
  env: Env,
  location: AuditLocation,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  detail: Record<string, unknown> | null,
  now = Date.now(),
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_events (
       id, actor_id, action, entity_type, entity_id, detail, ip_address, province, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    actorId,
    action,
    entityType,
    entityId,
    detail ? JSON.stringify(detail) : null,
    location.ipAddress,
    location.province,
    now,
  ).run()
}
