import {
  clearSessionCookie,
  hashPassword,
  login,
  requireAuth,
  sessionCookie,
  verifyPassword,
} from './auth'
import { audit, expireReservations, getBookingWindow, getState, type AuditLocation } from './db'
import {
  assertSameOrigin,
  errorResponse,
  HttpError,
  json,
  optionalBoolean,
  readJsonObject,
  requiredBoolean,
  requiredNumber,
  requiredString,
} from './http'
import { SessionNotifier } from './session-notifier'

export { SessionNotifier } from './session-notifier'

const DEFAULT_PASSWORD_SALT = 'HwEOBdokadDPVZ0tZceMlw=='
const DEFAULT_PASSWORD_HASH = 'Ud8T+IAyiTIu9ce0owZT8bxx9yLxtDaYaBXuzLqFgQ4='
const RECEIPT_LIMIT_BYTES = 10 * 1024 * 1024
const RECEIPT_TYPES = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/heif'])
const RESERVATION_TTL_MS = 72 * 60 * 60 * 1000

interface ReservationLookupRow {
  id: string
  branch_id: string
  status: 'Waiting for Approved' | 'Confirmed' | 'Cancel'
  receipt_key: string | null
  expires_at: number
}

interface ReceiptRow {
  branch_id: string
  receipt_key: string | null
  receipt_type: string | null
}

interface PasswordRow {
  password_salt: string
  password_hash: string
}

interface ExistingProductRow {
  id: string
}

interface ProductUsageRow {
  id: string
  reservation_count: number
}

interface BranchUsageRow {
  id: string
  reservation_count: number
}

interface ExistingReservationRow {
  id: string
}

interface ReservationDeleteRow {
  id: string
  product_id: string
  status: 'Waiting for Approved' | 'Confirmed' | 'Cancel'
  receipt_key: string | null
}

interface PublicBranchRow {
  id: string
  code: string
  name: string
  username: string
}

interface AuditEventRow {
  id: string
  actor_id: string | null
  actor_username: string | null
  branch_code: string | null
  action: string
  entity_type: string
  entity_id: string | null
  detail: string | null
  ip_address: string | null
  province: string | null
  created_at: number
}

function routeId(path: string, expression: RegExp): string | null {
  const match = path.match(expression)
  return match?.[1] ? decodeURIComponent(match[1]) : null
}

function isSqlError(error: unknown, text: string): boolean {
  return error instanceof Error && error.message.includes(text)
}

function sessionPayload(user: Awaited<ReturnType<typeof requireAuth>>): Record<string, unknown> {
  return user.role === 'admin'
    ? { role: 'admin' }
    : { role: 'branch', branchId: user.id }
}

function auditLocation(request: Request): AuditLocation {
  const forwardedFor = request.headers.get('x-forwarded-for')
  const ipAddress = request.headers.get('cf-connecting-ip')
    ?? forwardedFor?.split(',', 1)[0]?.trim()
    ?? null
  const city = typeof request.cf?.city === 'string' ? request.cf.city : null
  const regionCode = typeof request.cf?.regionCode === 'string' ? request.cf.regionCode : null
  return {
    ipAddress,
    // Cloudflare supplies the nearest city for the client IP. In Thailand this
    // is the most useful province-level signal available at the edge.
    province: city ?? regionCode ?? null,
  }
}

async function handlePublicBranches(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT id, branch_code AS code, branch_name AS name, username
     FROM users
     WHERE role = 'branch' AND active = 1
     ORDER BY branch_code COLLATE NOCASE`,
  ).all<PublicBranchRow>()
  return json({ ok: true, branches: result.results })
}

async function handleAuditEvents(request: Request, env: Env): Promise<Response> {
  const user = await requireAuth(request, env)
  if (user.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', 'เฉพาะ Admin เท่านั้น')
  const result = await env.DB.prepare(
    `SELECT a.id, a.actor_id, u.username AS actor_username, u.branch_code,
            a.action, a.entity_type, a.entity_id, a.detail, a.ip_address, a.province, a.created_at
     FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
     ORDER BY a.created_at DESC LIMIT 500`,
  ).all<AuditEventRow>()
  return json({
    ok: true,
    events: result.results.map((row) => ({
      ...row,
      ip: row.ip_address ?? 'ไม่ระบุ',
      province: row.province ?? 'ไม่ระบุ',
    })),
  })
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  assertSameOrigin(request)
  const data = await readJsonObject(request, 20_000)
  const identifier = requiredString(data, 'identifier', 'ชื่อผู้ใช้', 100)
  const password = requiredString(data, 'password', 'รหัสผ่าน', 128)
  const role = data.role
  if (role !== 'branch' && role !== 'admin') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'ประเภทผู้ใช้ไม่ถูกต้อง')
  }
  const now = Date.now()
  const { user, token } = await login(env, identifier, password, role, now)
  try {
    const notifier = env.SESSION_NOTIFIER.getByName(`session:${user.id}`) as DurableObjectStub<SessionNotifier>
    await notifier.invalidate()
  } catch (error) {
    // The database check still blocks the old session if realtime delivery is
    // temporarily unavailable. Do not leave a successful login unusable.
    console.error('Unable to notify the replaced session', error)
  }
  await audit(env, auditLocation(request), user.id, 'auth.login', 'session', user.id, { role: user.role }, now)
  return json(
    { ok: true, session: sessionPayload(user) },
    { headers: { 'set-cookie': sessionCookie(token, request) } },
  )
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  assertSameOrigin(request)
  try {
    const user = await requireAuth(request, env)
    await env.DB.batch([
      env.DB.prepare(
        'UPDATE users SET active_session_token_hash = NULL WHERE id = ? AND active_session_token_hash = ?',
      ).bind(user.id, user.tokenHash),
      env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(user.tokenHash),
    ])
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 401) throw error
  }
  return json(
    { ok: true },
    { headers: { 'set-cookie': clearSessionCookie(request) } },
  )
}

async function handleSessionEvents(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    throw new HttpError(426, 'UPGRADE_REQUIRED', 'ต้องเชื่อมต่อแบบ WebSocket')
  }
  const user = await requireAuth(request, env)
  return env.SESSION_NOTIFIER.getByName(`session:${user.id}`).fetch(request)
}

async function handleChangePassword(request: Request, env: Env): Promise<Response> {
  assertSameOrigin(request)
  const user = await requireAuth(request, env)
  const data = await readJsonObject(request, 20_000)
  const currentPassword = requiredString(data, 'currentPassword', 'รหัสผ่านปัจจุบัน', 128)
  const newPassword = requiredString(data, 'newPassword', 'รหัสผ่านใหม่', 128)
  if (newPassword.length < 4) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร')
  }

  const password = await env.DB.prepare(
    'SELECT password_salt, password_hash FROM users WHERE id = ?',
  ).bind(user.id).first<PasswordRow>()
  if (!password || !(await verifyPassword(currentPassword, password.password_salt, password.password_hash))) {
    throw new HttpError(400, 'INVALID_PASSWORD', 'รหัสผ่านปัจจุบันไม่ถูกต้อง')
  }

  const next = await hashPassword(newPassword)
  const now = Date.now()
  await env.DB.prepare(
    'UPDATE users SET password_salt = ?, password_hash = ?, updated_at = ? WHERE id = ?',
  ).bind(next.salt, next.hash, now, user.id).run()
  await audit(env, auditLocation(request), user.id, 'password.changed', 'user', user.id, null, now)
  return json({ ok: true })
}

async function handleState(request: Request, env: Env): Promise<Response> {
  const user = await requireAuth(request, env)
  await expireReservations(env, Date.now())
  return json({ ok: true, state: await getState(env, user) })
}

async function bookingIsOpen(env: Env, now: number): Promise<boolean> {
  return (await getBookingWindow(env, now)).open
}

async function handleCreateReservation(request: Request, env: Env): Promise<Response> {
  assertSameOrigin(request)
  const user = await requireAuth(request, env, 'branch')
  const data = await readJsonObject(request, 30_000)
  const productId = requiredString(data, 'productId', 'สินค้า', 100)
  const customerName = requiredString(data, 'customerName', 'ชื่อลูกค้า', 150)
  const customerPhone = requiredString(data, 'customerPhone', 'เบอร์โทรลูกค้า', 30)
  const digits = customerPhone.replace(/\D/g, '')
  if (digits.length < 9 || digits.length > 10) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'กรุณากรอกเบอร์โทรศัพท์ 9–10 หลัก')
  }
  const idempotencyKey = (request.headers.get('idempotency-key') ?? data.idempotencyKey)
  if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 100) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Idempotency Key ไม่ถูกต้อง')
  }

  const replay = await env.DB.prepare(
    'SELECT id FROM reservations WHERE branch_id = ? AND idempotency_key = ?',
  ).bind(user.id, idempotencyKey).first<ExistingReservationRow>()
  if (replay) return json({ ok: true, reservationId: replay.id, replayed: true })

  const now = Date.now()
  await expireReservations(env, now)
  if (!(await bookingIsOpen(env, now))) {
    throw new HttpError(409, 'BOOKING_CLOSED', 'ระบบยังไม่เปิดรับจอง กรุณารอเวลาเปิดจาก Server')
  }

  const reservationId = `PRE-${now.toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
  try {
    await env.DB.prepare(
      `INSERT INTO reservations (
        id, product_id, branch_id, customer_name, customer_phone, status,
        created_at, expires_at, updated_at, idempotency_key
      ) VALUES (?, ?, ?, ?, ?, 'Waiting for Approved', ?, ?, ?, ?)`,
    ).bind(
      reservationId,
      productId,
      user.id,
      customerName,
      customerPhone,
      now,
      now + RESERVATION_TTL_MS,
      now,
      idempotencyKey,
    ).run()
  } catch (error) {
    if (isSqlError(error, 'SOLD_OUT')) {
      throw new HttpError(409, 'SOLD_OUT', 'Stock ถูกจองครบแล้ว กรุณาเลือกสินค้าอื่น')
    }
    if (isSqlError(error, 'UNIQUE constraint failed')) {
      const existing = await env.DB.prepare(
        'SELECT id FROM reservations WHERE branch_id = ? AND idempotency_key = ?',
      ).bind(user.id, idempotencyKey).first<ExistingReservationRow>()
      if (existing) return json({ ok: true, reservationId: existing.id, replayed: true })
    }
    throw error
  }

  await audit(env, auditLocation(request), user.id, 'reservation.created', 'reservation', reservationId, { productId }, now)
  return json({ ok: true, reservationId, replayed: false }, { status: 201 })
}

async function handleCancelReservation(request: Request, env: Env, reservationId: string): Promise<Response> {
  assertSameOrigin(request)
  const user = await requireAuth(request, env, 'branch')
  const data = await readJsonObject(request, 20_000)
  const reasonValue = data.reason
  const reason = typeof reasonValue === 'string' && reasonValue.trim()
    ? reasonValue.trim().slice(0, 250)
    : 'สาขายกเลิกเอง'
  const now = Date.now()
  const result = await env.DB.prepare(
    `UPDATE reservations
     SET status = 'Cancel', cancel_reason = ?, updated_at = ?
     WHERE id = ? AND branch_id = ? AND status <> 'Cancel'`,
  ).bind(reason, now, reservationId, user.id).run()
  if (result.meta.changes === 0) {
    throw new HttpError(409, 'NOT_CANCELLABLE', 'รายการนี้ถูกยกเลิกแล้วหรือไม่สามารถยกเลิกได้')
  }
  await audit(env, auditLocation(request), user.id, 'reservation.cancelled', 'reservation', reservationId, { reason }, now)
  return json({ ok: true })
}

function receiptExtension(type: string): string {
  if (type === 'image/png') return 'png'
  if (type === 'image/heic') return 'heic'
  if (type === 'image/heif') return 'heif'
  return 'jpg'
}

async function handleReceiptUpload(request: Request, env: Env, reservationId: string): Promise<Response> {
  assertSameOrigin(request)
  const user = await requireAuth(request, env, 'branch')
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > RECEIPT_LIMIT_BYTES + 1_000_000) {
    throw new HttpError(413, 'FILE_TOO_LARGE', 'ไฟล์รูปต้องมีขนาดไม่เกิน 10 MB')
  }
  await expireReservations(env, Date.now())
  const reservation = await env.DB.prepare(
    'SELECT id, branch_id, status, receipt_key, expires_at FROM reservations WHERE id = ?',
  ).bind(reservationId).first<ReservationLookupRow>()
  if (!reservation || reservation.branch_id !== user.id) {
    throw new HttpError(404, 'NOT_FOUND', 'ไม่พบรายการจอง')
  }
  if (reservation.status !== 'Waiting for Approved' || reservation.expires_at <= Date.now()) {
    throw new HttpError(409, 'UPLOAD_CLOSED', 'รายการนี้ไม่สามารถอัปโหลดใบเสร็จได้แล้ว')
  }

  const form = await request.formData()
  const file = form.get('receipt')
  if (!(file instanceof File)) throw new HttpError(400, 'FILE_REQUIRED', 'กรุณาเลือกไฟล์รูปใบเสร็จ')
  if (!RECEIPT_TYPES.has(file.type)) {
    throw new HttpError(400, 'INVALID_FILE_TYPE', 'รองรับเฉพาะ JPG, PNG หรือ HEIC')
  }
  if (file.size <= 0 || file.size > RECEIPT_LIMIT_BYTES) {
    throw new HttpError(413, 'FILE_TOO_LARGE', 'ไฟล์รูปต้องมีขนาดไม่เกิน 10 MB')
  }

  const safeKey = `receipts/${reservationId}/${crypto.randomUUID()}.${receiptExtension(file.type)}`
  await env.RECEIPTS.put(safeKey, await file.arrayBuffer())

  const now = Date.now()
  try {
    const update = await env.DB.prepare(
      `UPDATE reservations
       SET receipt_key = ?, receipt_name = ?, receipt_type = ?, receipt_uploaded_at = ?, updated_at = ?
       WHERE id = ? AND branch_id = ? AND status = 'Waiting for Approved' AND expires_at > ?`,
    ).bind(safeKey, file.name.slice(0, 200), file.type, now, now, reservationId, user.id, now).run()
    if (update.meta.changes === 0) {
      throw new HttpError(409, 'UPLOAD_CLOSED', 'รายการนี้ไม่สามารถอัปโหลดใบเสร็จได้แล้ว')
    }
  } catch (error) {
    await env.RECEIPTS.delete(safeKey)
    throw error
  }

  if (reservation.receipt_key) await env.RECEIPTS.delete(reservation.receipt_key)
  await audit(env, auditLocation(request), user.id, 'receipt.uploaded', 'reservation', reservationId, { type: file.type, size: file.size }, now)
  return json({ ok: true })
}

async function handleReceiptDownload(request: Request, env: Env, reservationId: string): Promise<Response> {
  const user = await requireAuth(request, env)
  const reservation = await env.DB.prepare(
    'SELECT branch_id, receipt_key, receipt_type FROM reservations WHERE id = ?',
  ).bind(reservationId).first<ReceiptRow>()
  if (!reservation || !reservation.receipt_key || (user.role !== 'admin' && reservation.branch_id !== user.id)) {
    throw new HttpError(404, 'NOT_FOUND', 'ไม่พบใบเสร็จ')
  }

  const object = await env.RECEIPTS.get(reservation.receipt_key, 'arrayBuffer')
  if (!object) throw new HttpError(404, 'NOT_FOUND', 'ไม่พบใบเสร็จ')
  return new Response(object, {
    headers: {
      'content-type': reservation.receipt_type ?? 'application/octet-stream',
      'cache-control': 'private, no-store',
      'content-security-policy': "default-src 'none'; sandbox",
      'x-content-type-options': 'nosniff',
    },
  })
}

async function handleAdminReservationStatus(
  request: Request,
  env: Env,
  reservationId: string,
): Promise<Response> {
  assertSameOrigin(request)
  const user = await requireAuth(request, env, 'admin')
  const data = await readJsonObject(request, 20_000)
  const status = data.status
  if (status !== 'Confirmed' && status !== 'Cancel') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'สถานะไม่ถูกต้อง')
  }
  const now = Date.now()
  const result = status === 'Confirmed'
    ? await env.DB.prepare(
        `UPDATE reservations SET status = 'Confirmed', updated_at = ?
         WHERE id = ? AND status = 'Waiting for Approved'`,
      ).bind(now, reservationId).run()
    : await env.DB.prepare(
        `UPDATE reservations SET status = 'Cancel', cancel_reason = 'Admin ไม่อนุมัติ', updated_at = ?
         WHERE id = ? AND status <> 'Cancel'`,
      ).bind(now, reservationId).run()
  if (result.meta.changes === 0) {
    throw new HttpError(409, 'STATUS_CONFLICT', status === 'Confirmed'
      ? 'รายการไม่อยู่ในสถานะรอตรวจสอบก่อนอนุมัติ'
      : 'รายการนี้ถูกยกเลิกแล้ว')
  }
  await audit(env, auditLocation(request), user.id, `reservation.${status === 'Confirmed' ? 'confirmed' : 'rejected'}`, 'reservation', reservationId, null, now)
  return json({ ok: true })
}

async function handleDeleteReservations(request: Request, env: Env): Promise<Response> {
  assertSameOrigin(request)
  const user = await requireAuth(request, env, 'admin')
  const data = await readJsonObject(request, 100_000)
  if (!Array.isArray(data.reservationIds) || data.reservationIds.length === 0 || data.reservationIds.length > 500) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'กรุณาเลือกรายการจอง 1–500 รายการ')
  }
  const ids = [...new Set(data.reservationIds.map((value) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 100) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'เลขที่การจองไม่ถูกต้อง')
    }
    return value.trim()
  }))]
  const found = await env.DB.batch(ids.map((id) => env.DB.prepare(
    'SELECT id, product_id, status, receipt_key FROM reservations WHERE id = ?',
  ).bind(id)))
  const reservations = found
    .map((result) => result.results[0] as ReservationDeleteRow | undefined)
    .filter((row): row is ReservationDeleteRow => Boolean(row))
  if (!reservations.length) return json({ ok: true, count: 0 })

  const now = Date.now()
  const statements = reservations.flatMap((reservation) => [
    ...(reservation.status === 'Cancel' ? [] : [env.DB.prepare(
      'UPDATE products SET remaining_stock = MIN(total_stock, remaining_stock + 1), updated_at = ? WHERE id = ?',
    ).bind(now, reservation.product_id)]),
    env.DB.prepare('DELETE FROM reservations WHERE id = ?').bind(reservation.id),
  ])
  await env.DB.batch(statements)
  await Promise.all(reservations.filter((reservation) => reservation.receipt_key).map((reservation) => env.RECEIPTS.delete(reservation.receipt_key!)))
  await audit(env, auditLocation(request), user.id, 'reservations.deleted', 'reservation', null, { count: reservations.length, reservationIds: reservations.map((reservation) => reservation.id) }, now)
  return json({ ok: true, count: reservations.length })
}

interface ProductInput {
  id: string
  sku: string
  name: string
  price: number
  totalStock: number
  active: boolean
}

function productInput(value: unknown): ProductInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'ข้อมูลสินค้าไม่ถูกต้อง')
  }
  const data = value as Record<string, unknown>
  const id = requiredString(data, 'id', 'Part Number', 100)
  const sku = requiredString(data, 'sku', 'Part Number', 100)
  const name = requiredString(data, 'name', 'ชื่อสินค้า', 300)
  const price = Math.max(0, Math.floor(requiredNumber(data, 'price')))
  const totalStock = Math.max(0, Math.floor(requiredNumber(data, 'totalStock')))
  const active = optionalBoolean(data, 'active', true)
  return { id, sku, name, price, totalStock, active }
}

async function handleUpsertProduct(request: Request, env: Env, productId: string): Promise<Response> {
  assertSameOrigin(request)
  const user = await requireAuth(request, env, 'admin')
  const product = productInput(await readJsonObject(request, 100_000))
  if (product.id !== productId) throw new HttpError(400, 'VALIDATION_ERROR', 'Part Number ไม่ตรงกัน')
  const now = Date.now()
  const existing = await env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(productId).first<ExistingProductRow>()
  if (existing) {
    const result = await env.DB.prepare(
      `UPDATE products
       SET sku = ?, name = ?, price = ?, total_stock = ?,
           remaining_stock = ? - (
             SELECT COUNT(*) FROM reservations
             WHERE product_id = ? AND status <> 'Cancel'
           ), active = ?, updated_at = ?
       WHERE id = ? AND ? >= (
         SELECT COUNT(*) FROM reservations WHERE product_id = ? AND status <> 'Cancel'
       )`,
    ).bind(
      product.sku,
      product.name,
      product.price,
      product.totalStock,
      product.totalStock,
      productId,
      product.active ? 1 : 0,
      now,
      productId,
      product.totalStock,
      productId,
    ).run()
    if (result.meta.changes === 0) {
      throw new HttpError(409, 'STOCK_BELOW_RESERVED', 'Stock ทั้งหมดต่ำกว่าจำนวนรายการที่ยัง Active')
    }
  } else {
    await env.DB.prepare(
      `INSERT INTO products (id, sku, name, price, total_stock, remaining_stock, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      product.id,
      product.sku,
      product.name,
      product.price,
      product.totalStock,
      product.totalStock,
      product.active ? 1 : 0,
      now,
      now,
    ).run()
  }
  await audit(env, auditLocation(request), user.id, 'product.saved', 'product', productId, { totalStock: product.totalStock }, now)
  return json({ ok: true })
}

async function handleImportProducts(request: Request, env: Env): Promise<Response> {
  assertSameOrigin(request)
  const user = await requireAuth(request, env, 'admin')
  const data = await readJsonObject(request, 2_000_000)
  if (!Array.isArray(data.products) || data.products.length === 0 || data.products.length > 500) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'ไฟล์สินค้าต้องมี 1–500 รายการ')
  }
  const products = data.products.map(productInput)
  const seen = new Set<string>()
  for (const product of products) {
    const key = product.id.toLowerCase()
    if (seen.has(key)) throw new HttpError(400, 'DUPLICATE_PRODUCT', `Part Number ซ้ำ: ${product.id}`)
    seen.add(key)
  }
  const now = Date.now()
  const statements = products.map((product) => env.DB.prepare(
    `INSERT INTO products (id, sku, name, price, total_stock, remaining_stock, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       sku = excluded.sku, name = excluded.name, price = excluded.price,
       active = excluded.active, updated_at = excluded.updated_at`,
  ).bind(
    product.id,
    product.sku,
    product.name,
    product.price,
    product.totalStock,
    product.totalStock,
    product.active ? 1 : 0,
    now,
    now,
  ))
  await env.DB.batch(statements)
  await audit(env, auditLocation(request), user.id, 'products.imported', 'product', null, { count: products.length }, now)
  return json({ ok: true, count: products.length })
}

async function handleDeleteProducts(request: Request, env: Env): Promise<Response> {
  assertSameOrigin(request)
  const user = await requireAuth(request, env, 'admin')
  const data = await readJsonObject(request, 100_000)
  const scope = data.scope
  if (scope !== 'selected' && scope !== 'all') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'ขอบเขตการลบสินค้าไม่ถูกต้อง')
  }

  let productIds: string[]
  if (scope === 'all') {
    const result = await env.DB.prepare('SELECT id FROM products ORDER BY id').all<{ id: string }>()
    productIds = result.results.map((row) => row.id)
  } else {
    if (!Array.isArray(data.productIds) || data.productIds.length === 0 || data.productIds.length > 500) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'กรุณาเลือกสินค้า 1–500 รายการ')
    }
    productIds = data.productIds.map((value) => {
      if (typeof value !== 'string' || !value.trim() || value.length > 100) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Part Number ที่เลือกไม่ถูกต้อง')
      }
      return value.trim()
    })
    productIds = [...new Set(productIds)]
  }

  if (productIds.length === 0) return json({ ok: true, count: 0 })

  const usageChecks = await env.DB.batch(productIds.map((productId) => env.DB.prepare(
    `SELECT p.id, COUNT(r.id) AS reservation_count
     FROM products p
     LEFT JOIN reservations r ON r.product_id = p.id
     WHERE p.id = ?
     GROUP BY p.id`,
  ).bind(productId)))
  const productsInUse = usageChecks
    .map((result) => result.results[0] as ProductUsageRow | undefined)
    .filter((row): row is ProductUsageRow => Boolean(row && row.reservation_count > 0))
  if (productsInUse.length > 0) {
    throw new HttpError(
      409,
      'PRODUCT_IN_USE',
      `ลบไม่ได้ เนื่องจาก ${productsInUse[0].id} มีประวัติการจอง`,
    )
  }

  try {
    const deletes = await env.DB.batch(productIds.map((productId) => (
      env.DB.prepare('DELETE FROM products WHERE id = ?').bind(productId)
    )))
    const count = deletes.reduce((sum, result) => sum + result.meta.changes, 0)
    await audit(env, auditLocation(request), user.id, 'products.deleted', 'product', null, { count, scope }, Date.now())
    return json({ ok: true, count })
  } catch (error) {
    if (isSqlError(error, 'FOREIGN KEY constraint failed')) {
      throw new HttpError(409, 'PRODUCT_IN_USE', 'ลบไม่ได้ เนื่องจากมีสินค้าในรายการที่ถูกใช้อ้างอิงในการจอง')
    }
    throw error
  }
}

interface BranchInput {
  id: string
  code: string
  name: string
  username: string
  active: boolean
}

function branchInput(value: unknown): BranchInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'ข้อมูลสาขาไม่ถูกต้อง')
  }
  const data = value as Record<string, unknown>
  const id = requiredString(data, 'id', 'รหัสสาขา', 30).replace(/^JIB-/i, '')
  const code = `JIB-${id}`
  const name = requiredString(data, 'name', 'ชื่อสาขา', 250)
  const username = requiredString(data, 'username', 'Username', 100)
  const active = optionalBoolean(data, 'active', true)
  return { id, code, name, username, active }
}

async function saveBranches(env: Env, branches: BranchInput[], now: number): Promise<void> {
  const statements = branches.map((branch) => env.DB.prepare(
    `INSERT INTO users (
      id, branch_code, branch_name, username, role, password_salt, password_hash,
      active, session_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'branch', ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      branch_code = excluded.branch_code, branch_name = excluded.branch_name,
      username = excluded.username, active = excluded.active, updated_at = excluded.updated_at`,
  ).bind(
    branch.id,
    branch.code,
    branch.name,
    branch.username,
    DEFAULT_PASSWORD_SALT,
    DEFAULT_PASSWORD_HASH,
    branch.active ? 1 : 0,
    now,
    now,
  ))
  await env.DB.batch(statements)
}

async function handleUpsertBranch(request: Request, env: Env, branchId: string): Promise<Response> {
  assertSameOrigin(request)
  const user = await requireAuth(request, env, 'admin')
  const branch = branchInput(await readJsonObject(request, 100_000))
  if (branch.id !== branchId) throw new HttpError(400, 'VALIDATION_ERROR', 'รหัสสาขาไม่ตรงกัน')
  const now = Date.now()
  await saveBranches(env, [branch], now)
  await audit(env, auditLocation(request), user.id, 'branch.saved', 'user', branchId, { active: branch.active }, now)
  return json({ ok: true })
}

async function handleImportBranches(request: Request, env: Env): Promise<Response> {
  assertSameOrigin(request)
  const user = await requireAuth(request, env, 'admin')
  const data = await readJsonObject(request, 2_000_000)
  if (!Array.isArray(data.branches) || data.branches.length === 0 || data.branches.length > 500) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'ไฟล์สาขาต้องมี 1–500 รายการ')
  }
  const branches = data.branches.map(branchInput)
  const seen = new Set<string>()
  for (const branch of branches) {
    if (seen.has(branch.id)) throw new HttpError(400, 'DUPLICATE_BRANCH', `รหัสสาขาซ้ำ: ${branch.id}`)
    seen.add(branch.id)
  }
  const now = Date.now()
  await saveBranches(env, branches, now)
  await audit(env, auditLocation(request), user.id, 'branches.imported', 'user', null, { count: branches.length }, now)
  return json({ ok: true, count: branches.length })
}

async function handleDeleteBranches(request: Request, env: Env): Promise<Response> {
  assertSameOrigin(request)
  const user = await requireAuth(request, env, 'admin')
  const data = await readJsonObject(request, 100_000)
  const scope = data.scope
  if (scope !== 'selected' && scope !== 'all') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'ขอบเขตการลบสาขาไม่ถูกต้อง')
  }

  let branchIds: string[]
  if (scope === 'all') {
    const result = await env.DB.prepare(
      `SELECT id FROM users WHERE role = 'branch' ORDER BY id`,
    ).all<{ id: string }>()
    branchIds = result.results.map((row) => row.id)
  } else {
    if (!Array.isArray(data.branchIds) || data.branchIds.length === 0 || data.branchIds.length > 500) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'กรุณาเลือกสาขา 1–500 รายการ')
    }
    branchIds = data.branchIds.map((value) => {
      if (typeof value !== 'string' || !value.trim() || value.length > 30) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'รหัสสาขาที่เลือกไม่ถูกต้อง')
      }
      return value.replace(/^JIB-/i, '').trim()
    })
    branchIds = [...new Set(branchIds)]
  }

  if (branchIds.length === 0) return json({ ok: true, count: 0 })

  const usageChecks = await env.DB.batch(branchIds.map((branchId) => env.DB.prepare(
    `SELECT u.id, COUNT(r.id) AS reservation_count
     FROM users u
     LEFT JOIN reservations r ON r.branch_id = u.id
     WHERE u.id = ? AND u.role = 'branch'
     GROUP BY u.id`,
  ).bind(branchId)))
  const branchesInUse = usageChecks
    .map((result) => result.results[0] as BranchUsageRow | undefined)
    .filter((row): row is BranchUsageRow => Boolean(row && row.reservation_count > 0))
  if (branchesInUse.length > 0) {
    throw new HttpError(
      409,
      'BRANCH_IN_USE',
      `ลบไม่ได้ เนื่องจาก JIB-${branchesInUse[0].id} มีประวัติการจอง`,
    )
  }

  try {
    const deletes = await env.DB.batch(branchIds.map((branchId) => (
      env.DB.prepare(`DELETE FROM users WHERE id = ? AND role = 'branch' RETURNING id`).bind(branchId)
    )))
    const count = deletes.reduce((sum, result) => sum + result.results.length, 0)
    await audit(env, auditLocation(request), user.id, 'branches.deleted', 'user', null, { count, scope }, Date.now())
    return json({ ok: true, count })
  } catch (error) {
    if (isSqlError(error, 'FOREIGN KEY constraint failed')) {
      throw new HttpError(409, 'BRANCH_IN_USE', 'ลบไม่ได้ เนื่องจากมีสาขาในรายการที่ถูกใช้อ้างอิงในการจอง')
    }
    throw error
  }
}

async function handleResetPassword(request: Request, env: Env, branchId: string): Promise<Response> {
  assertSameOrigin(request)
  const user = await requireAuth(request, env, 'admin')
  const now = Date.now()
  const update = await env.DB.prepare(
    `UPDATE users
     SET password_salt = ?, password_hash = ?, session_version = session_version + 1,
         active_session_token_hash = NULL, updated_at = ?
     WHERE id = ? AND role = 'branch'`,
  ).bind(DEFAULT_PASSWORD_SALT, DEFAULT_PASSWORD_HASH, now, branchId).run()
  if (update.meta.changes === 0) throw new HttpError(404, 'NOT_FOUND', 'ไม่พบผู้ใช้สาขา')
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(branchId).run()
  await audit(env, auditLocation(request), user.id, 'password.reset', 'user', branchId, null, now)
  return json({ ok: true })
}

async function handleBookingSetting(request: Request, env: Env): Promise<Response> {
  assertSameOrigin(request)
  const user = await requireAuth(request, env, 'admin')
  const data = await readJsonObject(request, 20_000)
  const enabledKey = Object.hasOwn(data, 'bookingEnabled') ? 'bookingEnabled' : 'bookingOpen'
  const enabled = requiredBoolean(data, enabledKey)
  const hasSchedule = Object.hasOwn(data, 'opensAt') || Object.hasOwn(data, 'closesAt')

  const parseScheduleTime = (key: 'opensAt' | 'closesAt', label: string): number | null => {
    const value = data[key]
    if (value === null || value === '') return null
    if (typeof value !== 'string') {
      throw new HttpError(400, 'VALIDATION_ERROR', `${label}ไม่ถูกต้อง`)
    }
    const parsed = Date.parse(value)
    if (!Number.isFinite(parsed)) {
      throw new HttpError(400, 'VALIDATION_ERROR', `${label}ไม่ถูกต้อง`)
    }
    return parsed
  }

  const opensAt = hasSchedule ? parseScheduleTime('opensAt', 'เวลาเปิดรับจอง') : null
  const closesAt = hasSchedule ? parseScheduleTime('closesAt', 'เวลาปิดรับจอง') : null
  if (opensAt && closesAt && closesAt <= opensAt) {
    throw new HttpError(400, 'INVALID_BOOKING_WINDOW', 'เวลาปิดรับจองต้องอยู่หลังเวลาเปิดรับจอง')
  }

  const now = Date.now()
  const statements = [
    env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES ('booking_open', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).bind(enabled ? '1' : '0', now),
  ]
  if (hasSchedule) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES ('booking_opens_at', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).bind(opensAt ? String(opensAt) : '', now),
      env.DB.prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES ('booking_closes_at', ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).bind(closesAt ? String(closesAt) : '', now),
    )
  }
  await env.DB.batch(statements)
  await audit(env, auditLocation(request), user.id, 'booking.setting.changed', 'setting', 'booking_window', {
    enabled,
    ...(hasSchedule ? { opensAt, closesAt, timeZone: 'Asia/Bangkok' } : {}),
  }, now)
  return json({ ok: true })
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname

  if (request.method === 'GET' && path === '/api/v1/health') {
    return json({ ok: true, service: 'jib-pre-interest', serverTime: new Date().toISOString() })
  }
  if (request.method === 'GET' && path === '/api/v1/public/branches') {
    return handlePublicBranches(env)
  }
  if (request.method === 'POST' && path === '/api/v1/auth/login') return handleLogin(request, env)
  if (request.method === 'POST' && path === '/api/v1/auth/logout') return handleLogout(request, env)
  if (request.method === 'GET' && path === '/api/v1/auth/session-events') {
    return handleSessionEvents(request, env)
  }
  if (request.method === 'GET' && path === '/api/v1/auth/session') {
    const user = await requireAuth(request, env)
    return json({ ok: true, session: sessionPayload(user) })
  }
  if (request.method === 'POST' && path === '/api/v1/auth/change-password') {
    return handleChangePassword(request, env)
  }
  if (request.method === 'GET' && path === '/api/v1/state') return handleState(request, env)
  if (request.method === 'GET' && path === '/api/v1/admin/audit-events') return handleAuditEvents(request, env)
  if (request.method === 'POST' && path === '/api/v1/reservations') {
    return handleCreateReservation(request, env)
  }

  const cancelId = routeId(path, /^\/api\/v1\/reservations\/([^/]+)\/cancel$/)
  if (request.method === 'POST' && cancelId) return handleCancelReservation(request, env, cancelId)
  const receiptId = routeId(path, /^\/api\/v1\/reservations\/([^/]+)\/receipt$/)
  if (request.method === 'POST' && receiptId) return handleReceiptUpload(request, env, receiptId)
  if (request.method === 'GET' && receiptId) return handleReceiptDownload(request, env, receiptId)

  const adminReservationId = routeId(path, /^\/api\/v1\/admin\/reservations\/([^/]+)\/status$/)
  if (request.method === 'POST' && adminReservationId) {
    return handleAdminReservationStatus(request, env, adminReservationId)
  }
  if (request.method === 'POST' && path === '/api/v1/admin/reservations/delete') {
    return handleDeleteReservations(request, env)
  }
  const productId = routeId(path, /^\/api\/v1\/admin\/products\/([^/]+)$/)
  if (request.method === 'PUT' && productId) return handleUpsertProduct(request, env, productId)
  if (request.method === 'POST' && path === '/api/v1/admin/products/import') {
    return handleImportProducts(request, env)
  }
  if (request.method === 'POST' && path === '/api/v1/admin/products/delete') {
    return handleDeleteProducts(request, env)
  }
  const branchId = routeId(path, /^\/api\/v1\/admin\/branches\/([^/]+)$/)
  if (request.method === 'PUT' && branchId) return handleUpsertBranch(request, env, branchId)
  if (request.method === 'POST' && path === '/api/v1/admin/branches/import') {
    return handleImportBranches(request, env)
  }
  if (request.method === 'POST' && path === '/api/v1/admin/branches/delete') {
    return handleDeleteBranches(request, env)
  }
  const resetId = routeId(path, /^\/api\/v1\/admin\/branches\/([^/]+)\/reset-password$/)
  if (request.method === 'POST' && resetId) return handleResetPassword(request, env, resetId)
  if (request.method === 'POST' && path === '/api/v1/admin/settings/booking') {
    return handleBookingSetting(request, env)
  }

  throw new HttpError(404, 'NOT_FOUND', 'ไม่พบ API ที่เรียกใช้งาน')
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env)
    } catch (error) {
      return errorResponse(error, request)
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = Date.now()
    ctx.waitUntil((async () => {
      const expiredReservations = await expireReservations(env, now)
      const expiredSessions = await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now).run()
      console.log(JSON.stringify({
        message: 'scheduled cleanup complete',
        expiredReservations,
        expiredSessions: expiredSessions.meta.changes,
        serverTime: new Date(now).toISOString(),
      }))
    })())
  },
} satisfies ExportedHandler<Env>
