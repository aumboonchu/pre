import { HttpError, parseCookies } from './http'

export const SESSION_COOKIE = 'jib_pre_session'
const SESSION_TTL_SECONDS = 12 * 60 * 60
const PASSWORD_ITERATIONS = 120_000

export interface AuthUser {
  id: string
  role: 'branch' | 'admin'
  branchCode: string | null
  branchName: string
  username: string
  sessionVersion: number
  tokenHash: string
}

interface UserAuthRow {
  id: string
  role: 'branch' | 'admin'
  branch_code: string | null
  branch_name: string
  username: string
  password_salt: string
  password_hash: string
  session_version: number
}

interface SessionRow {
  id: string
  role: 'branch' | 'admin'
  branch_code: string | null
  branch_name: string
  username: string
  session_version: number
  token_hash: string
}

const encoder = new TextEncoder()

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function derivePassword(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const saltBuffer = Uint8Array.from(salt).buffer
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBuffer, iterations: PASSWORD_ITERATIONS },
    key,
    256,
  )
  return new Uint8Array(bits)
}

export async function verifyPassword(password: string, salt: string, expected: string): Promise<boolean> {
  const [actualHash, expectedHash] = await Promise.all([
    derivePassword(password, base64ToBytes(salt)),
    Promise.resolve(base64ToBytes(expected)),
  ])
  if (actualHash.byteLength !== expectedHash.byteLength) return false
  let difference = 0
  for (let index = 0; index < actualHash.byteLength; index += 1) {
    difference |= actualHash[index] ^ expectedHash[index]
  }
  return difference === 0
}

export async function hashPassword(password: string): Promise<{ salt: string; hash: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derivePassword(password, salt)
  return { salt: bytesToBase64(salt), hash: bytesToBase64(hash) }
}

async function hashToken(token: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token))))
}

function createToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export async function login(
  env: Env,
  identifier: string,
  password: string,
  role: 'branch' | 'admin',
  now: number,
): Promise<{ user: AuthUser; token: string }> {
  const normalized = identifier.trim()
  const user = await env.DB.prepare(
    `SELECT id, role, branch_code, branch_name, username, password_salt, password_hash, session_version
     FROM users
     WHERE active = 1 AND role = ?
       AND (username = ? COLLATE NOCASE OR branch_code = ? COLLATE NOCASE OR id = ?)
     LIMIT 1`,
  ).bind(role, normalized, normalized, normalized.replace(/^JIB-/i, '')).first<UserAuthRow>()

  if (!user || !(await verifyPassword(password, user.password_salt, user.password_hash))) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
  }

  const token = createToken()
  const tokenHash = await hashToken(token)
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, session_version, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(tokenHash, user.id, user.session_version, now + SESSION_TTL_SECONDS * 1000, now).run()

  return {
    token,
    user: {
      id: user.id,
      role: user.role,
      branchCode: user.branch_code,
      branchName: user.branch_name,
      username: user.username,
      sessionVersion: user.session_version,
      tokenHash,
    },
  }
}

export async function requireAuth(
  request: Request,
  env: Env,
  requiredRole?: 'branch' | 'admin',
): Promise<AuthUser> {
  const token = parseCookies(request).get(SESSION_COOKIE)
  if (!token) throw new HttpError(401, 'UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ')
  const tokenHash = await hashToken(token)
  const now = Date.now()
  const user = await env.DB.prepare(
    `SELECT u.id, u.role, u.branch_code, u.branch_name, u.username,
            u.session_version, s.token_hash
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1
       AND s.session_version = u.session_version
     LIMIT 1`,
  ).bind(tokenHash, now).first<SessionRow>()

  if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่')
  if (requiredRole && user.role !== requiredRole) {
    throw new HttpError(403, 'FORBIDDEN', 'ไม่มีสิทธิ์ใช้งานส่วนนี้')
  }
  return {
    id: user.id,
    role: user.role,
    branchCode: user.branch_code,
    branchName: user.branch_name,
    username: user.username,
    sessionVersion: user.session_version,
    tokenHash: user.token_hash,
  }
}

export function sessionCookie(token: string, request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secure}`
}

export function clearSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : ''
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`
}
