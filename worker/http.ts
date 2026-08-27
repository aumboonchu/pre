export class HttpError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const apiHeaders = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, {
    ...init,
    headers: { ...apiHeaders, ...init.headers },
  })
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) {
    throw new HttpError(403, 'INVALID_ORIGIN', 'ไม่อนุญาตให้ส่งข้อมูลจากเว็บไซต์อื่น')
  }
}

export function parseCookies(request: Request): Map<string, string> {
  const cookies = new Map<string, string>()
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const separator = part.indexOf('=')
    if (separator <= 0) continue
    const key = part.slice(0, separator).trim()
    const value = part.slice(separator + 1).trim()
    if (key) cookies.set(key, value)
  }
  return cookies
}

export async function readJsonObject(request: Request, maxBytes = 1_000_000): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get('content-length') ?? 0)
  if (Number.isFinite(length) && length > maxBytes) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'ข้อมูลมีขนาดใหญ่เกินกำหนด')
  }

  let value: unknown
  try {
    value = await request.json()
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'รูปแบบข้อมูลไม่ถูกต้อง')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'INVALID_BODY', 'รูปแบบข้อมูลไม่ถูกต้อง')
  }
  return value as Record<string, unknown>
}

export function requiredString(
  data: Record<string, unknown>,
  key: string,
  label: string,
  maxLength: number,
): string {
  const value = data[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, 'VALIDATION_ERROR', `กรุณากรอก${label}`)
  }
  const normalized = value.trim()
  if (normalized.length > maxLength) {
    throw new HttpError(400, 'VALIDATION_ERROR', `${label}ยาวเกินกำหนด`)
  }
  return normalized
}

export function requiredBoolean(data: Record<string, unknown>, key: string): boolean {
  const value = data[key]
  if (typeof value !== 'boolean') {
    throw new HttpError(400, 'VALIDATION_ERROR', 'รูปแบบข้อมูลไม่ถูกต้อง')
  }
  return value
}

export function requiredNumber(data: Record<string, unknown>, key: string): number {
  const value = data[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'รูปแบบตัวเลขไม่ถูกต้อง')
  }
  return value
}

export function optionalBoolean(data: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = data[key]
  return typeof value === 'boolean' ? value : fallback
}

export function errorResponse(error: unknown, request: Request): Response {
  if (error instanceof HttpError) {
    return json({ ok: false, code: error.code, message: error.message }, { status: error.status })
  }

  const message = error instanceof Error ? error.message : String(error)
  console.error(JSON.stringify({
    message: 'request failed',
    error: message,
    method: request.method,
    path: new URL(request.url).pathname,
  }))
  return json(
    { ok: false, code: 'INTERNAL_ERROR', message: 'ระบบขัดข้อง กรุณาลองใหม่อีกครั้ง' },
    { status: 500 },
  )
}
