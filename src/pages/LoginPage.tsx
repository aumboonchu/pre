import { type FormEvent, useEffect, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Brand } from '../components/Common'
import { api } from '../lib/api'
import { SESSION_REPLACED_NOTICE_KEY, useAppStore } from '../store/AppStore'
import type { BranchDirectoryEntry } from '../types'

export function LoginPage() {
  const { state, session, loginAdmin, loginBranch } = useAppStore()
  const navigate = useNavigate()
  const remoteMode = import.meta.env.VITE_API_MODE === 'remote'
  const [role, setRole] = useState<'branch' | 'admin'>('branch')
  const [identifier, setIdentifier] = useState(remoteMode ? '' : 'JIB-284')
  const [password, setPassword] = useState(remoteMode ? '' : '1234')
  const [error, setError] = useState('')
  const [branchDirectory, setBranchDirectory] = useState<BranchDirectoryEntry[]>(
    remoteMode ? [] : state.branches,
  )

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_REPLACED_NOTICE_KEY) !== '1') return
      sessionStorage.removeItem(SESSION_REPLACED_NOTICE_KEY)
      setError('บัญชีนี้มีการเข้าสู่ระบบจากเครื่องอื่นแล้ว จึงไม่สามารถใช้งานเครื่องนี้ต่อได้')
    } catch {
      // The page can still be used when browser storage is unavailable.
    }
  }, [])

  useEffect(() => {
    if (!remoteMode) return
    let active = true

    const refreshDirectory = async () => {
      try {
        const branches = await api.branchDirectory()
        if (active) setBranchDirectory(branches)
      } catch {
        // Users can still type their branch code or username if the directory is unavailable.
      }
    }
    const refreshOnVisible = () => {
      if (document.visibilityState === 'visible') void refreshDirectory()
    }

    void refreshDirectory()
    window.addEventListener('focus', refreshDirectory)
    document.addEventListener('visibilitychange', refreshOnVisible)
    return () => {
      active = false
      window.removeEventListener('focus', refreshDirectory)
      document.removeEventListener('visibilitychange', refreshOnVisible)
    }
  }, [remoteMode])

  if (session?.role === 'branch') return <Navigate to="/branch" replace />
  if (session?.role === 'admin') return <Navigate to="/admin" replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    try {
      const valid =
        role === 'branch'
          ? await loginBranch(identifier, password)
          : await loginAdmin(identifier, password)
      if (!valid) {
        setError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
        return
      }
      navigate(role === 'branch' ? '/branch' : '/admin')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'เข้าสู่ระบบไม่สำเร็จ')
    }
  }

  const switchRole = (next: 'branch' | 'admin') => {
    setRole(next)
    setError('')
    if (remoteMode) {
      setIdentifier('')
      setPassword('')
    } else if (next === 'branch') {
      setIdentifier('JIB-284')
      setPassword('1234')
    } else {
      setIdentifier('admin')
      setPassword('1234')
    }
  }

  return (
    <main className="login-page">
      <section className="login-story">
        <Brand />
        <div className="login-story__copy">
          <h1>จองได้อย่างมั่นใจ<br />Stock ไม่เกินจริง</h1>
          <p>
            ระบบจองสินค้าล่วงหน้าสำหรับสาขา JIB ทั่วประเทศ พร้อมรายงานภายในเว็บ
            และกลไกป้องกันการจองเกินเมื่อเปิดพร้อมกัน 20:00 น.
          </p>
        </div>
        <div className="rule-list">
          <div><strong>01</strong><span>1 เครื่องต่อรายการ<br /><small>สร้างหลายรายการได้</small></span></div>
          <div><strong>02</strong><span>แนบใบเสร็จใน 72 ชม.<br /><small>รองรับรูปถ่ายจากมือถือ</small></span></div>
          <div><strong>03</strong><span>Stock-safe real-time<br /><small>ตรวจสิทธิ์ทุกครั้งที่ Submit</small></span></div>
        </div>
        <p className="login-story__footer">Internal use only · Admin 1 account</p>
      </section>

      <section className="login-panel">
        <div className="login-card">
          <div className="login-card__heading">
            <span className="eyebrow">เข้าสู่ระบบ</span>
            <h2>{role === 'branch' ? 'สำหรับพนักงานสาขา' : 'สำหรับผู้ดูแลระบบ'}</h2>
            <p>เลือกประเภทบัญชีและกรอกข้อมูลเพื่อดำเนินการต่อ</p>
          </div>
          <div className="role-switch" aria-label="ประเภทบัญชี">
            <button className={role === 'branch' ? 'active' : ''} onClick={() => switchRole('branch')} type="button">สาขา</button>
            <button className={role === 'admin' ? 'active' : ''} onClick={() => switchRole('admin')} type="button">Admin</button>
          </div>
          <form className="form-stack" onSubmit={submit}>
            <label>
              <span>{role === 'branch' ? 'รหัสสาขา / Username' : 'Username'}</span>
              <input
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                list={role === 'branch' ? 'branch-codes' : undefined}
                autoComplete="username"
                required
              />
              {role === 'branch' && (
                <datalist id="branch-codes">
                  {branchDirectory.map((branch) => (
                    <option key={branch.id} value={branch.code}>
                      {branch.name} · {branch.username}
                    </option>
                  ))}
                </datalist>
              )}
            </label>
            <label>
              <span>รหัสผ่าน</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="button button--primary button--large" type="submit">เข้าสู่ระบบ</button>
          </form>
          {!remoteMode && (
            <div className="demo-credential">
              <span>บัญชีทดสอบ</span>
              <code>{role === 'branch' ? 'JIB-284 / 1234' : 'admin / 1234'}</code>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
