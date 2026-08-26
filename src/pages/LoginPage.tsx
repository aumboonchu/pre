import { type FormEvent, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { Brand } from '../components/Common'
import { useAppStore } from '../store/AppStore'

export function LoginPage() {
  const { state, session, loginAdmin, loginBranch } = useAppStore()
  const navigate = useNavigate()
  const [role, setRole] = useState<'branch' | 'admin'>('branch')
  const [identifier, setIdentifier] = useState('JIB-284')
  const [password, setPassword] = useState('1234')
  const [error, setError] = useState('')

  if (session?.role === 'branch') return <Navigate to="/branch" replace />
  if (session?.role === 'admin') return <Navigate to="/admin" replace />

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const valid =
      role === 'branch'
        ? loginBranch(identifier, password)
        : loginAdmin(identifier, password)
    if (!valid) {
      setError('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง')
      return
    }
    navigate(role === 'branch' ? '/branch' : '/admin')
  }

  const switchRole = (next: 'branch' | 'admin') => {
    setRole(next)
    setError('')
    if (next === 'branch') {
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
          <span className="eyebrow eyebrow--orange">PRE-ORDER OPERATIONS</span>
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
                  {state.branches.map((branch) => (
                    <option key={branch.id} value={branch.code}>{branch.name}</option>
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
            <button className="button button--primary button--large" type="submit">เข้าสู่ระบบ <span>→</span></button>
          </form>
          <div className="demo-credential">
            <span>บัญชีทดสอบ</span>
            <code>{role === 'branch' ? 'JIB-284 / 1234' : 'admin / 1234'}</code>
          </div>
        </div>
      </section>
    </main>
  )
}
