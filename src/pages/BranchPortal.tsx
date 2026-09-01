import { type ChangeEvent, type FormEvent, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Brand, EmptyState, Modal, StatusBadge, Toast } from '../components/Common'
import { useToast } from '../hooks/useToast'
import { cleanProductName, currency, dateTime, fileToDataUrl, timeRemaining } from '../lib/format'
import { useAppStore } from '../store/AppStore'
import type { Product, Receipt } from '../types'

type BranchTab = 'catalog' | 'reservations' | 'password'

const receiptFromFile = async (file: File): Promise<Receipt> => {
  const validExtension = /\.(jpe?g|png|heic|heif)$/i.test(file.name)
  const validType = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', ''].includes(file.type)
  if (!validExtension || !validType) throw new Error('รองรับเฉพาะ JPG, PNG หรือ HEIC')
  if (file.size > 10 * 1024 * 1024) throw new Error('ไฟล์รูปต้องมีขนาดไม่เกิน 10 MB')
  return {
    name: file.name,
    type: file.type || 'image/heic',
    dataUrl: await fileToDataUrl(file),
    uploadedAt: new Date().toISOString(),
  }
}

function ReservationModal({
  product,
  branchId,
  onClose,
  onSuccess,
}: {
  product: Product
  branchId: string
  onClose: () => void
  onSuccess: () => void
}) {
  const { reserve } = useAppStore()
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [idempotencyKey] = useState(() => crypto.randomUUID())

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    const digits = customerPhone.replace(/\D/g, '')
    if (digits.length < 9 || digits.length > 10) {
      setError('กรุณากรอกเบอร์โทรศัพท์ 9–10 หลัก')
      return
    }
    setSubmitting(true)
    try {
      const receipt = file ? await receiptFromFile(file) : undefined
      const result = await reserve({
        productId: product.id,
        branchId,
        customerName,
        customerPhone,
        idempotencyKey,
        receipt,
      })
      if (!result.ok) {
        setError(result.message)
        return
      }
      onSuccess()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'สร้างรายการไม่สำเร็จ')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal title="สร้างรายการจอง" onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <div className="selected-product">
          <div>
            <strong>{cleanProductName(product.name)}</strong>
            <span>{product.sku} · {currency(product.price)}</span>
            <span className={`selected-product__stock ${product.remainingStock > 0 ? 'is-available' : 'is-sold-out'}`}>
              Stock คงเหลือ {product.remainingStock} เครื่อง
            </span>
          </div>
          <span className="quantity-pill">จำนวน 1</span>
        </div>
        <div className="form-grid">
          <label>
            <span>ชื่อลูกค้า <b>*</b></span>
            <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="ชื่อ–นามสกุล" required autoFocus />
          </label>
          <label>
            <span>เบอร์โทรลูกค้า <b>*</b></span>
            <input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} placeholder="08x-xxx-xxxx" inputMode="tel" required />
          </label>
        </div>
        <label className="upload-box">
          <input type="file" accept=".jpg,.jpeg,.png,.heic,.heif,image/jpeg,image/png,image/heic,image/heif" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          <span className="upload-box__icon">＋</span>
          <strong>{file ? file.name : 'แนบรูปใบเสร็จ (ไม่บังคับตอนจอง)'}</strong>
          <small>รูปถ่ายมือถือ JPG / PNG / HEIC · ไม่เกิน 10 MB</small>
        </label>
        <div className="notice notice--warning">
          <strong>กรุณาอัปโหลดใบเสร็จภายใน 72 ชั่วโมง</strong>
          <span>หากเลยกำหนด ระบบจะยกเลิกรายการและคืน Stock โดยอัตโนมัติ</span>
        </div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>ยกเลิก</button>
          <button type="submit" className="button button--primary" disabled={submitting || product.remainingStock <= 0}>
            {submitting ? 'กำลังตรวจสอบ Stock…' : 'ยืนยันการจอง 1 เครื่อง'}
          </button>
        </div>
        <p className="safeguard-note">ระบบใช้ Idempotency Key และตรวจ Stock อีกครั้งเมื่อ Submit</p>
      </form>
    </Modal>
  )
}

export function BranchPortal() {
  const { state, session, logout, cancel, uploadReceipt, changePassword } = useAppStore()
  const { toast, showToast } = useToast()
  const [tab, setTab] = useState<BranchTab>('catalog')
  const [query, setQuery] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  if (session?.role !== 'branch') return <Navigate to="/login" replace />
  const branch = state.branches.find((item) => item.id === session.branchId)
  if (!branch) return <Navigate to="/login" replace />

  const products = state.products.filter(
    (product) => product.active && `${product.name} ${product.sku}`.toLowerCase().includes(query.toLowerCase()),
  )
  const reservations = state.reservations.filter((item) => item.branchId === branch.id)
  const waiting = reservations.filter((item) => item.status === 'Waiting for Approved').length
  const confirmed = reservations.filter((item) => item.status === 'Confirmed').length
  const nextDeadline = reservations
    .filter((item) => item.status === 'Waiting for Approved' && !item.receipt)
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt))[0]

  const handleReceipt = async (reservationId: string, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      await uploadReceipt(reservationId, await receiptFromFile(file))
      showToast('อัปโหลดใบเสร็จเรียบร้อย รอ Admin ตรวจสอบ')
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'อัปโหลดไม่สำเร็จ', 'error')
    }
    event.target.value = ''
  }

  const handleCancel = async (reservationId: string) => {
    if (!window.confirm('ยืนยันยกเลิกรายการจอง? Stock จะถูกคืนทันที')) return
    try {
      await cancel(reservationId, 'สาขายกเลิกเอง')
      showToast('ยกเลิกรายการและคืน Stock เรียบร้อย')
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'ยกเลิกรายการไม่สำเร็จ', 'error')
    }
  }

  const handlePassword = async (event: FormEvent) => {
    event.preventDefault()
    if (newPassword.length < 4) return showToast('รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร', 'error')
    if (newPassword !== confirmPassword) return showToast('ยืนยันรหัสผ่านไม่ตรงกัน', 'error')
    try {
      if (!(await changePassword(currentPassword, newPassword))) {
        return showToast('รหัสผ่านปัจจุบันไม่ถูกต้อง', 'error')
      }
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      showToast('เปลี่ยนรหัสผ่านเรียบร้อย')
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'เปลี่ยนรหัสผ่านไม่สำเร็จ', 'error')
    }
  }

  return (
    <div className="app-page">
      <header className="topbar">
        <Brand compact />
        <div className="topbar__status"><span className={state.settings.bookingOpen ? 'live-dot' : 'closed-dot'} /> {state.settings.bookingOpen ? 'เปิดรับจอง' : 'ปิดรับจอง'} · {state.settings.opensAtLabel}</div>
        <div className="topbar__account">
          <div><strong>{branch.name}</strong><span>{branch.code} · {branch.username}</span></div>
          <button type="button" className="button button--dark" onClick={logout}>ออกจากระบบ</button>
        </div>
      </header>

      <nav className="portal-nav">
        <button className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}><span>▦</span> สินค้าที่เปิดจอง</button>
        <button className={tab === 'reservations' ? 'active' : ''} onClick={() => setTab('reservations')}><span>≡</span> รายการจองของฉัน <b>{reservations.length}</b></button>
        <button className={tab === 'password' ? 'active' : ''} onClick={() => setTab('password')}><span>⌘</span> เปลี่ยนรหัสผ่าน</button>
      </nav>

      <main className="page-content">
        {tab === 'catalog' && (
          <>
            <section className="page-heading">
              <div><span className="eyebrow eyebrow--orange">BRANCH PORTAL</span><h1>สินค้าที่เปิดจอง</h1><p>จองได้ครั้งละ 1 เครื่อง และสร้างได้หลายรายการ</p></div>
              <div className="heading-summary"><strong>{state.products.reduce((sum, item) => sum + item.remainingStock, 0)}</strong><span>Stock คงเหลือรวม</span></div>
            </section>
            <section className="branch-kpis">
              <div><span>รายการทั้งหมด</span><strong>{reservations.length}</strong></div>
              <div><span>รอตรวจสอบ</span><strong className="orange">{waiting}</strong></div>
              <div><span>ยืนยันแล้ว</span><strong className="green">{confirmed}</strong></div>
              <div><span>กำหนดใกล้สุด</span><strong className="small">{nextDeadline ? timeRemaining(nextDeadline.expiresAt) : 'ไม่มีรายการ'}</strong></div>
            </section>
            <div className="toolbar">
              <label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหาชื่อสินค้า หรือ Part Number" /></label>
              <span className="toolbar__meta">พบ {products.length} รายการ</span>
            </div>
            <section className="product-grid">
              {products.map((product) => (
                <article className={`product-card ${product.remainingStock === 0 ? 'product-card--sold' : ''}`} key={product.id}>
                  <div className="product-card__body">
                    <div className="product-card__meta">
                      <span>{product.sku}</span>
                      <span className={`stock-pill ${product.remainingStock > 0 ? 'stock-pill--available' : 'stock-pill--sold-out'}`}>
                        คงเหลือ {product.remainingStock} เครื่อง
                      </span>
                    </div>
                    <h3>{cleanProductName(product.name)}</h3>
                    <strong className="price">{currency(product.price)}</strong>
                    <button type="button" className="button button--primary button--full" disabled={product.remainingStock <= 0 || !state.settings.bookingOpen} onClick={() => setSelectedProduct(product)}>
                      {product.remainingStock > 0 ? 'จองสินค้า 1 เครื่อง' : 'สินค้าหมด'}
                    </button>
                  </div>
                </article>
              ))}
            </section>
          </>
        )}

        {tab === 'reservations' && (
          <>
            <section className="page-heading"><div><span className="eyebrow eyebrow--orange">MY RESERVATIONS</span><h1>รายการจองของฉัน</h1><p>ติดตามสถานะ แนบใบเสร็จ หรือยกเลิกได้จากหน้านี้</p></div></section>
            {reservations.length === 0 ? <EmptyState title="ยังไม่มีรายการจอง" description="กลับไปเลือกสินค้าและสร้างรายการแรกของคุณ" /> : (
              <section className="reservation-list">
                {reservations.map((reservation) => {
                  const product = state.products.find((item) => item.id === reservation.productId)
                  return (
                    <article className="reservation-card" key={reservation.id}>
                      <div className="reservation-card__top"><div><span className="eyebrow">{reservation.id}</span><h3>{product ? cleanProductName(product.name) : reservation.productId}</h3><p>{product?.sku}</p></div><StatusBadge status={reservation.status} /></div>
                      <div className="reservation-details"><div><span>ลูกค้า</span><strong>{reservation.customerName}</strong><small>{reservation.customerPhone}</small></div><div><span>วันที่จอง</span><strong>{dateTime(reservation.createdAt)}</strong></div><div><span>ใบเสร็จ</span><strong>{reservation.receipt ? 'แนบแล้ว' : 'ยังไม่แนบ'}</strong><small>{!reservation.receipt && reservation.status !== 'Cancel' ? `เหลือ ${timeRemaining(reservation.expiresAt)}` : reservation.receipt?.name}</small></div></div>
                      <div className="reservation-card__actions">
                        {reservation.receipt && reservation.receipt.type !== 'image/heic' && <a className="button button--ghost" href={reservation.receipt.dataUrl} target="_blank" rel="noreferrer">ดูใบเสร็จ</a>}
                        {!reservation.receipt && reservation.status === 'Waiting for Approved' && <label className="button button--outline">อัปโหลดใบเสร็จ<input type="file" hidden accept=".jpg,.jpeg,.png,.heic,.heif,image/jpeg,image/png,image/heic,image/heif" onChange={(event) => handleReceipt(reservation.id, event)} /></label>}
                        {reservation.status !== 'Cancel' && <button type="button" className="button button--danger-ghost" onClick={() => handleCancel(reservation.id)}>ยกเลิกจอง</button>}
                      </div>
                      {reservation.cancelReason && <p className="cancel-reason">เหตุผล: {reservation.cancelReason}</p>}
                    </article>
                  )
                })}
              </section>
            )}
          </>
        )}

        {tab === 'password' && (
          <section className="settings-layout">
            <div className="page-heading"><div><span className="eyebrow eyebrow--orange">ACCOUNT SECURITY</span><h1>เปลี่ยนรหัสผ่าน</h1><p>รหัสผ่านใหม่จะมีผลในการเข้าสู่ระบบครั้งถัดไป</p></div></div>
            <form className="settings-card form-stack" onSubmit={handlePassword}>
              <div className="settings-card__intro"><div className="security-icon">⌘</div><div><h2>{branch.username}</h2><p>{branch.name} · {branch.code}</p></div></div>
              <label><span>รหัสผ่านปัจจุบัน</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
              <label><span>รหัสผ่านใหม่</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={4} required /></label>
              <label><span>ยืนยันรหัสผ่านใหม่</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={4} required /></label>
              <button type="submit" className="button button--primary">บันทึกรหัสผ่านใหม่</button>
            </form>
          </section>
        )}
      </main>
      {selectedProduct && (
        <ReservationModal
          product={selectedProduct}
          branchId={branch.id}
          onClose={() => setSelectedProduct(null)}
          onSuccess={() => {
            setSelectedProduct(null)
            showToast('สร้างรายการจองเรียบร้อย')
          }}
        />
      )}
      {toast && <Toast {...toast} />}
    </div>
  )
}
