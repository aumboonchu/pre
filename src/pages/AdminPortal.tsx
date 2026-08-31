import { type ChangeEvent, type FormEvent, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Brand, ClockIcon, EmptyState, Modal, PackageIcon, StatusBadge, Toast } from '../components/Common'
import { useToast } from '../hooks/useToast'
import { exportReservationsExcel, readBranchesExcel, readProductsExcel } from '../lib/excel'
import { cleanProductName, currency, dateTime } from '../lib/format'
import { useAppStore } from '../store/AppStore'
import type { BranchUser, Product, Reservation, ReservationStatus } from '../types'

type AdminTab = 'overview' | 'reservations' | 'products' | 'users' | 'schedule' | 'password'

const bangkokInputValue = (iso: string | null) => {
  if (!iso) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Bangkok',
  }).formatToParts(new Date(iso))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`
}

const bangkokInputToIso = (value: string) => {
  if (!value) return null
  const withSeconds = value.length === 16 ? `${value}:00` : value
  return new Date(`${withSeconds}+07:00`).toISOString()
}

function ReceiptViewer({ reservation, onClose }: { reservation: Reservation; onClose: () => void }) {
  const receipt = reservation.receipt
  if (!receipt) return null
  const browserPreview = receipt.type !== 'image/heic' && receipt.type !== 'image/heif'
  return (
    <Modal title={`ใบเสร็จ ${reservation.id}`} onClose={onClose} wide>
      <div className="receipt-viewer">
        {browserPreview
          ? <img src={receipt.dataUrl} alt={`ใบเสร็จ ${reservation.id}`} />
          : <div className="receipt-viewer__fallback"><strong>ไฟล์ {receipt.type.toUpperCase()}</strong><span>Browser อาจไม่รองรับการแสดงตัวอย่างไฟล์นี้</span></div>}
        <div className="receipt-viewer__footer">
          <span>{receipt.name} · อัปโหลด {dateTime(receipt.uploadedAt)}</span>
          <a className="button button--outline" href={receipt.dataUrl} target="_blank" rel="noreferrer">เปิดไฟล์ต้นฉบับ</a>
        </div>
      </div>
    </Modal>
  )
}

function ProductEditor({ product, onClose, onSaved }: { product?: Product; onClose: () => void; onSaved: () => void }) {
  const { upsertProduct } = useAppStore()
  const [sku, setSku] = useState(product?.sku ?? '')
  const [name, setName] = useState(product?.name ?? '')
  const [price, setPrice] = useState(String(product?.price ?? 0))
  const [stock, setStock] = useState(String(product?.totalStock ?? 0))
  const [active, setActive] = useState(product?.active ?? true)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const normalizedSku = sku.trim()
    setError('')
    try {
      await upsertProduct({
        id: product?.id ?? normalizedSku,
        sku: normalizedSku,
        name: name.trim(),
        price: Math.max(0, Number(price)),
        totalStock: Math.max(0, Math.floor(Number(stock))),
        remainingStock: product?.remainingStock ?? Math.max(0, Math.floor(Number(stock))),
        active,
      })
      onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'บันทึกสินค้าไม่สำเร็จ')
    }
  }

  return (
    <Modal title={product ? 'แก้ไขสินค้าและ Stock' : 'เพิ่มสินค้า'} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <label><span>Part Number / SKU</span><input value={sku} onChange={(event) => setSku(event.target.value)} disabled={Boolean(product)} required /></label>
        <label><span>ชื่อสินค้า</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <div className="form-grid">
          <label><span>ราคาขาย</span><input type="number" min="0" value={price} onChange={(event) => setPrice(event.target.value)} required /></label>
          <label><span>Stock ที่เปิดให้จอง</span><input type="number" min="0" value={stock} onChange={(event) => setStock(event.target.value)} required /></label>
        </div>
        <label className="toggle-row"><span><strong>เปิดรับจองสินค้า</strong><small>สินค้าที่ปิดจะไม่แสดงในหน้าสาขา</small></span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /></label>
        <div className="notice"><strong>Stock safety</strong><span>ระบบจะไม่อนุญาตให้ลด Stock ต่ำกว่าจำนวนรายการที่ยัง Active</span></div>
        {error && <p className="form-error">{error}</p>}
        <div className="modal__actions"><button type="button" className="button button--ghost" onClick={onClose}>ยกเลิก</button><button type="submit" className="button button--primary">บันทึกสินค้า</button></div>
      </form>
    </Modal>
  )
}

function BranchEditor({ branch, onClose, onSaved }: { branch?: BranchUser; onClose: () => void; onSaved: () => void }) {
  const { upsertBranch } = useAppStore()
  const [id, setId] = useState(branch?.id ?? '')
  const [name, setName] = useState(branch?.name ?? '')
  const [username, setUsername] = useState(branch?.username ?? '')
  const [active, setActive] = useState(branch?.active ?? true)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const normalizedId = id.replace(/^JIB-/i, '').trim()
    setError('')
    try {
      await upsertBranch({
        id: normalizedId,
        code: `JIB-${normalizedId}`,
        name: name.trim(),
        username: username.trim() || `jib${normalizedId}`,
        password: branch?.password ?? '1234',
        active,
      })
      onSaved()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'บันทึกผู้ใช้ไม่สำเร็จ')
    }
  }

  return (
    <Modal title={branch ? 'แก้ไขผู้ใช้สาขา' : 'เพิ่มผู้ใช้สาขา'} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <label><span>รหัสสาขา</span><input value={id} onChange={(event) => setId(event.target.value)} placeholder="เช่น 311" disabled={Boolean(branch)} required /></label>
        <label><span>ชื่อสาขา</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label><span>Username</span><input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="ระบบสร้าง jib + รหัสสาขาให้อัตโนมัติ" /></label>
        <label className="toggle-row"><span><strong>เปิดใช้งานบัญชี</strong><small>ปิดเพื่อระงับการเข้าสู่ระบบชั่วคราว</small></span><input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} /></label>
        {!branch && <div className="notice notice--warning"><strong>รหัสผ่านเริ่มต้น 1234</strong><span>Admin สามารถ Reset กลับเป็น 1234 ได้ภายหลัง</span></div>}
        {error && <p className="form-error">{error}</p>}
        <div className="modal__actions"><button type="button" className="button button--ghost" onClick={onClose}>ยกเลิก</button><button type="submit" className="button button--primary">บันทึกผู้ใช้</button></div>
      </form>
    </Modal>
  )
}

export function AdminPortal() {
  const {
    state,
    session,
    logout,
    approve,
    reject,
    importProducts,
    deleteProducts,
    importBranches,
    deleteBranches,
    resetBranchPassword,
    setBookingOpen,
    setBookingSchedule,
    changePassword,
  } = useAppStore()
  const { toast, showToast } = useToast()
  const [tab, setTab] = useState<AdminTab>('overview')
  const [reservationFilter, setReservationFilter] = useState<'All' | ReservationStatus>('Waiting for Approved')
  const [productQuery, setProductQuery] = useState('')
  const [branchQuery, setBranchQuery] = useState('')
  const [editingProduct, setEditingProduct] = useState<Product | 'new' | null>(null)
  const [editingBranch, setEditingBranch] = useState<BranchUser | 'new' | null>(null)
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(() => new Set())
  const [deletingProducts, setDeletingProducts] = useState(false)
  const [selectedBranchIds, setSelectedBranchIds] = useState<Set<string>>(() => new Set())
  const [deletingBranches, setDeletingBranches] = useState(false)
  const [selectedReceipt, setSelectedReceipt] = useState<Reservation | null>(null)
  const [scheduleEnabled, setScheduleEnabled] = useState(state.settings.bookingEnabled)
  const [scheduleOpensAt, setScheduleOpensAt] = useState(() => bangkokInputValue(state.settings.opensAt))
  const [scheduleClosesAt, setScheduleClosesAt] = useState(() => bangkokInputValue(state.settings.closesAt))
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  if (session?.role !== 'admin') return <Navigate to="/login" replace />

  const activeReservations = state.reservations.filter((item) => item.status !== 'Cancel')
  const waiting = state.reservations.filter((item) => item.status === 'Waiting for Approved').length
  const confirmed = state.reservations.filter((item) => item.status === 'Confirmed').length
  const cancelled = state.reservations.filter((item) => item.status === 'Cancel').length
  const totalStock = state.products.reduce((sum, item) => sum + item.totalStock, 0)
  const remainingStock = state.products.reduce((sum, item) => sum + item.remainingStock, 0)
  const reservedStock = totalStock - remainingStock
  const filteredReservations = state.reservations.filter((item) => reservationFilter === 'All' || item.status === reservationFilter)
  const filteredProducts = state.products.filter((item) => `${item.name} ${item.sku}`.toLowerCase().includes(productQuery.toLowerCase()))
  const filteredBranches = state.branches.filter((item) => `${item.name} ${item.code} ${item.username}`.toLowerCase().includes(branchQuery.toLowerCase()))

  const topBranches = state.branches
    .map((branch) => ({ branch, count: activeReservations.filter((item) => item.branchId === branch.id).length }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  const handleProductImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const products = await readProductsExcel(file)
      await importProducts(products)
      showToast(`นำเข้าสินค้า ${products.length} รายการเรียบร้อย`)
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'นำเข้าไฟล์ไม่สำเร็จ', 'error')
    }
    event.target.value = ''
  }

  const handleBranchImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const branches = await readBranchesExcel(file)
      await importBranches(branches)
      showToast(`นำเข้าสาขา ${branches.length} รายการเรียบร้อย`)
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'นำเข้าไฟล์ไม่สำเร็จ', 'error')
    }
    event.target.value = ''
  }

  const toggleProduct = (productId: string, checked: boolean) => {
    setSelectedProductIds((current) => {
      const next = new Set(current)
      if (checked) next.add(productId)
      else next.delete(productId)
      return next
    })
  }

  const toggleVisibleProducts = (checked: boolean) => {
    setSelectedProductIds((current) => {
      const next = new Set(current)
      for (const product of filteredProducts) {
        if (checked) next.add(product.id)
        else next.delete(product.id)
      }
      return next
    })
  }

  const handleDeleteProducts = async (scope: 'selected' | 'all', explicitProductIds?: string[]) => {
    const productIds = scope === 'selected' ? (explicitProductIds ?? [...selectedProductIds]) : undefined
    if (scope === 'selected' && !productIds?.length) return
    const label = scope === 'all' ? `สินค้าทั้งหมด ${state.products.length} รายการ` : `สินค้าที่เลือก ${productIds?.length} รายการ`
    if (!window.confirm(`ยืนยันลบ${label}?\n\nสินค้าที่มีประวัติการจองจะไม่สามารถลบได้`)) return
    setDeletingProducts(true)
    try {
      const count = await deleteProducts(productIds)
      setSelectedProductIds(new Set())
      showToast(`ลบสินค้า ${count} รายการเรียบร้อย`)
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'ลบสินค้าไม่สำเร็จ', 'error')
    } finally {
      setDeletingProducts(false)
    }
  }

  const toggleBranch = (branchId: string, checked: boolean) => {
    setSelectedBranchIds((current) => {
      const next = new Set(current)
      if (checked) next.add(branchId)
      else next.delete(branchId)
      return next
    })
  }

  const toggleVisibleBranches = (checked: boolean) => {
    setSelectedBranchIds((current) => {
      const next = new Set(current)
      for (const branch of filteredBranches) {
        if (checked) next.add(branch.id)
        else next.delete(branch.id)
      }
      return next
    })
  }

  const handleDeleteBranches = async (scope: 'selected' | 'all', explicitBranchIds?: string[]) => {
    const branchIds = scope === 'selected' ? (explicitBranchIds ?? [...selectedBranchIds]) : undefined
    if (scope === 'selected' && !branchIds?.length) return
    const label = scope === 'all' ? `ผู้ใช้สาขาทั้งหมด ${state.branches.length} บัญชี` : `ผู้ใช้สาขาที่เลือก ${branchIds?.length} บัญชี`
    if (!window.confirm(`ยืนยันลบ${label}?\n\nสาขาที่มีประวัติการจองจะไม่สามารถลบได้`)) return
    setDeletingBranches(true)
    try {
      const count = await deleteBranches(branchIds)
      setSelectedBranchIds(new Set())
      showToast(`ลบผู้ใช้สาขา ${count} บัญชีเรียบร้อย`)
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'ลบผู้ใช้สาขาไม่สำเร็จ', 'error')
    } finally {
      setDeletingBranches(false)
    }
  }

  const approveItem = async (id: string) => {
    try {
      await approve(id)
      showToast('อนุมัติรายการจองเรียบร้อย')
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'อนุมัติรายการไม่สำเร็จ', 'error')
    }
  }

  const rejectItem = async (id: string) => {
    if (!window.confirm('ไม่อนุมัติรายการนี้? ระบบจะคืน Stock ทันที')) return
    try {
      await reject(id)
      showToast('ยกเลิกรายการและคืน Stock เรียบร้อย')
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'ยกเลิกรายการไม่สำเร็จ', 'error')
    }
  }

  const changeBookingSetting = async (open: boolean) => {
    try {
      await setBookingOpen(open)
      setScheduleEnabled(open)
      showToast(open ? 'เปิดรับจองแล้ว' : 'ปิดรับจองแล้ว')
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'เปลี่ยนสถานะระบบไม่สำเร็จ', 'error')
    }
  }

  const handleSchedule = async (event: FormEvent) => {
    event.preventDefault()
    const opensAt = bangkokInputToIso(scheduleOpensAt)
    const closesAt = bangkokInputToIso(scheduleClosesAt)
    if (opensAt && closesAt && Date.parse(closesAt) <= Date.parse(opensAt)) {
      showToast('เวลาปิดรับจองต้องอยู่หลังเวลาเปิดรับจอง', 'error')
      return
    }
    setSavingSchedule(true)
    try {
      await setBookingSchedule({ bookingEnabled: scheduleEnabled, opensAt, closesAt })
      showToast('บันทึกเวลาเปิด–ปิดรับจองเรียบร้อย')
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'บันทึกเวลาไม่สำเร็จ', 'error')
    } finally {
      setSavingSchedule(false)
    }
  }

  const handleReservationExport = async () => {
    if (filteredReservations.length === 0) {
      showToast('ไม่มีข้อมูลตามตัวกรองสำหรับ Export', 'error')
      return
    }
    try {
      await exportReservationsExcel(filteredReservations, state.products, state.branches)
      showToast(`Export ข้อมูล ${filteredReservations.length} รายการเรียบร้อย`)
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Export Excel ไม่สำเร็จ', 'error')
    }
  }

  const resetPassword = async (branch: BranchUser) => {
    try {
      await resetBranchPassword(branch.id)
      showToast(`${branch.code} ถูก Reset เป็น 1234 แล้ว`)
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'Reset password ไม่สำเร็จ', 'error')
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
      showToast('เปลี่ยนรหัสผ่าน Admin เรียบร้อย')
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'เปลี่ยนรหัสผ่านไม่สำเร็จ', 'error')
    }
  }

  const tabTitle: Record<AdminTab, string> = {
    overview: 'ภาพรวมระบบ',
    reservations: 'ตรวจสอบการจอง',
    products: 'สินค้าและ Stock',
    users: 'ผู้ใช้รายสาขา',
    schedule: 'ตั้งเวลาเปิด–ปิดรับจอง',
    password: 'เปลี่ยนรหัสผ่าน',
  }

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Brand compact />
        <div className="admin-sidebar__label">ADMIN CONSOLE</div>
        <nav>
          <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}><span>▦</span> Dashboard</button>
          <button className={tab === 'reservations' ? 'active' : ''} onClick={() => setTab('reservations')}><span>✓</span> ตรวจสอบการจอง <b>{waiting}</b></button>
          <button className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}><span><PackageIcon /></span> สินค้าและ Stock</button>
          <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}><span>♙</span> ผู้ใช้สาขา</button>
          <button className={tab === 'schedule' ? 'active' : ''} onClick={() => setTab('schedule')}><span><ClockIcon /></span> ตั้งเวลาเปิด–ปิด</button>
          <button className={tab === 'password' ? 'active' : ''} onClick={() => setTab('password')}><span>⌘</span> เปลี่ยน Password</button>
        </nav>
        <div className="admin-sidebar__safety"><strong>Stock-safe mode</strong><span>Atomic transaction</span><span>Idempotency key</span><span>72h stock restore</span></div>
        <button className="sidebar-logout" onClick={logout} type="button">ออกจากระบบ</button>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <div><span className="eyebrow eyebrow--orange">HQ / OPERATIONS PORTAL</span><h1>{tabTitle[tab]}</h1></div>
          <div className="admin-topbar__actions">
            <label className="system-switch"><span><strong>{state.settings.bookingOpen ? 'ระบบเปิดรับจอง' : 'ระบบปิดรับจอง'}</strong><small>{state.settings.opensAtLabel}</small></span><input type="checkbox" checked={state.settings.bookingEnabled} onChange={(event) => void changeBookingSetting(event.target.checked)} /></label>
            <div className="admin-avatar">A</div>
          </div>
        </header>

        <main className="admin-content">
          {tab === 'overview' && (
            <>
              <section className="admin-kpis">
                <article><span>รายการจองทั้งหมด</span><strong>{state.reservations.length}</strong><small>Active {activeReservations.length} รายการ</small></article>
                <article><span>Waiting for Approved</span><strong className="orange">{waiting}</strong><small>รอ Admin ดำเนินการ</small></article>
                <article><span>Confirmed</span><strong className="green">{confirmed}</strong><small>อนุมัติแล้ว</small></article>
                <article><span>Cancel</span><strong className="red">{cancelled}</strong><small>รวมหมดอายุ 72 ชม.</small></article>
              </section>
              <section className="dashboard-grid">
                <article className="panel panel--stock">
                  <div className="panel__header"><div><span className="eyebrow">STOCK SUMMARY</span><h2>Stock คงเหลือ</h2></div><strong>{remainingStock}<small> / {totalStock}</small></strong></div>
                  <div className="stock-ring" style={{ '--progress': `${totalStock ? (remainingStock / totalStock) * 100 : 0}%` } as React.CSSProperties}><div><strong>{totalStock ? Math.round((remainingStock / totalStock) * 100) : 0}%</strong><span>คงเหลือ</span></div></div>
                  <div className="stock-legend"><span><i className="legend-orange" /> จองแล้ว {reservedStock}</span><span><i className="legend-green" /> คงเหลือ {remainingStock}</span></div>
                </article>
                <article className="panel">
                  <div className="panel__header"><div><span className="eyebrow">TOP BRANCHES</span><h2>สาขาที่มีรายการจอง</h2></div></div>
                  <div className="bar-list">
                    {topBranches.map(({ branch, count }, index) => <div key={branch.id}><span>{branch.code}</span><div><i style={{ width: `${Math.max(5, (count / Math.max(1, topBranches[0]?.count)) * 100)}%` }} /></div><strong>{count}</strong><small>{index + 1}</small></div>)}
                  </div>
                </article>
                <article className="panel panel--wide">
                  <div className="panel__header"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>รายการล่าสุด</h2></div><button className="text-button" onClick={() => setTab('reservations')}>ดูทั้งหมด →</button></div>
                  {state.reservations.length === 0 ? <EmptyState title="ยังไม่มีรายการ" description="รายการใหม่จากสาขาจะปรากฏที่นี่" /> : <div className="compact-table">{state.reservations.slice(0, 6).map((reservation) => { const branch = state.branches.find((item) => item.id === reservation.branchId); const product = state.products.find((item) => item.id === reservation.productId); return <div key={reservation.id}><span><strong>{reservation.id}</strong><small>{dateTime(reservation.createdAt)}</small></span><span>{branch?.code}<small>{branch?.name}</small></span><span>{product ? cleanProductName(product.name) : reservation.productId}</span><StatusBadge status={reservation.status} /></div>})}</div>}
                </article>
              </section>
              <section className="safeguard-banner"><div><span>⚡</span><div><strong>Race Condition Defenses พร้อมทำงานจริง</strong><p>Database หัก Stock แบบ Atomic และบังคับ Unique Idempotency Key จึงไม่รับจองเกินแม้สาขากดพร้อมกัน</p></div></div><div className="safeguard-tags"><span>Atomic Stock</span><span>Idempotency</span><span>Scheduled Window</span><span>72h Restore</span></div></section>
            </>
          )}

          {tab === 'reservations' && (
            <>
              <div className="section-toolbar">
                <div className="filter-tabs">{(['All', 'Waiting for Approved', 'Confirmed', 'Cancel'] as const).map((status) => <button key={status} className={reservationFilter === status ? 'active' : ''} onClick={() => setReservationFilter(status)}>{status}{status === 'Waiting for Approved' && <b>{waiting}</b>}</button>)}</div>
                <div className="toolbar-actions"><span>แสดง {filteredReservations.length} รายการ</span><button type="button" className="button button--outline" onClick={() => void handleReservationExport()}>Export Excel</button></div>
              </div>
              {filteredReservations.length === 0 ? <EmptyState title="ไม่พบรายการจอง" description="ลองเลือกตัวกรองสถานะอื่น" /> : (
                <section className="review-grid">
                  {filteredReservations.map((reservation) => {
                    const branch = state.branches.find((item) => item.id === reservation.branchId)
                    const product = state.products.find((item) => item.id === reservation.productId)

                    return (
                      <article className="review-card" key={reservation.id}>
                        <div className="review-card__heading">
                          <div>
                            <span className="eyebrow">{reservation.id}</span>
                            <h3>{product ? cleanProductName(product.name) : reservation.productId}</h3>
                            <p>{product?.sku}</p>
                          </div>
                          <StatusBadge status={reservation.status} />
                        </div>

                        <dl>
                          <div><dt>สาขา</dt><dd><strong>{branch?.name ?? '—'}</strong><small>· {branch?.code ?? '—'}</small></dd></div>
                          <div><dt>ลูกค้า</dt><dd><strong>{reservation.customerName}</strong><small>· {reservation.customerPhone}</small></dd></div>
                          <div><dt>วันที่จอง</dt><dd><strong>{dateTime(reservation.createdAt)}</strong></dd></div>
                        </dl>

                        <div className={`review-card__receipt-row ${reservation.receipt ? 'review-card__receipt-row--ready' : ''}`}>
                          <div className="review-card__receipt-summary">
                            <i aria-hidden="true" />
                            <strong>{reservation.receipt ? 'แนบใบเสร็จแล้ว' : 'ยังไม่แนบใบเสร็จ'}</strong>
                            <small title={reservation.receipt?.name}>{reservation.receipt?.name ?? 'รออัปโหลดภายใน 72 ชม.'}</small>
                          </div>
                          <div className="review-card__actions">
                            {reservation.receipt && <button type="button" className="button button--outline" onClick={() => setSelectedReceipt(reservation)}>ดูใบเสร็จ</button>}
                            {reservation.status === 'Waiting for Approved' && <>
                              <button className="button button--danger-ghost" onClick={() => rejectItem(reservation.id)} disabled={!reservation.receipt}>ไม่อนุมัติ</button>
                              <button className="button button--success" onClick={() => approveItem(reservation.id)} disabled={!reservation.receipt}>อนุมัติ</button>
                            </>}
                          </div>
                        </div>

                        {!reservation.receipt && reservation.status === 'Waiting for Approved' && <p className="review-hint">รอใบเสร็จก่อนจึงจะอนุมัติรายการได้</p>}
                      </article>
                    )
                  })}
                </section>
              )}
            </>
          )}

          {tab === 'products' && (
            <>
              <div className="section-toolbar"><label className="search"><span>⌕</span><input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="ค้นหา Product / Part Number" /></label><div className="toolbar-actions toolbar-actions--bulk"><button className="button button--danger-ghost" disabled={selectedProductIds.size === 0 || deletingProducts} onClick={() => void handleDeleteProducts('selected')}>ลบที่เลือก ({selectedProductIds.size})</button><button className="button button--danger" disabled={state.products.length === 0 || deletingProducts} onClick={() => void handleDeleteProducts('all')}>ลบทั้งหมด</button><label className="button button--outline">นำเข้า Excel .xlsx<input hidden type="file" accept=".xlsx,.xls" onChange={handleProductImport} /></label><button className="button button--primary" onClick={() => setEditingProduct('new')}>＋ เพิ่มสินค้า</button></div></div>
              <div className="data-panel"><div className="data-panel__note"><strong>ข้อมูลตั้งต้นจาก pre order.xlsx</strong><span>เลือก checkbox เพื่อลบบางรายการ หรือใช้ปุ่มลบทั้งหมด · สินค้าที่มีประวัติการจองจะลบไม่ได้</span></div><div className="data-table data-table--products"><div className="data-table__head"><span className="select-cell"><input type="checkbox" aria-label="เลือกสินค้าที่แสดงทั้งหมด" checked={filteredProducts.length > 0 && filteredProducts.every((product) => selectedProductIds.has(product.id))} onChange={(event) => toggleVisibleProducts(event.target.checked)} /></span><span>สินค้า / Part Number</span><span>ราคา</span><span>Stock ทั้งหมด</span><span>จองแล้ว</span><span>คงเหลือ</span><span>สถานะ</span><span /></div>{filteredProducts.map((product) => { const booked = product.totalStock - product.remainingStock; return <div className="data-table__row" key={product.id}><span className="select-cell"><input type="checkbox" aria-label={`เลือก ${product.sku}`} checked={selectedProductIds.has(product.id)} onChange={(event) => toggleProduct(product.id, event.target.checked)} /></span><span><strong>{cleanProductName(product.name)}</strong><small>{product.sku}</small></span><span>{currency(product.price)}</span><span>{product.totalStock}</span><span>{booked}</span><span className={product.remainingStock > 0 ? 'green' : 'red'}><strong>{product.remainingStock}</strong></span><span><i className={product.active ? 'active-pill' : 'inactive-pill'}>{product.active ? 'เปิดจอง' : 'ปิด'}</i></span><span className="row-actions"><button className="text-button" onClick={() => setEditingProduct(product)}>แก้ไข</button><button className="text-button text-button--red" onClick={() => void handleDeleteProducts('selected', [product.id])}>ลบ</button></span></div>})}</div></div>
            </>
          )}

          {tab === 'users' && (
            <>
              <div className="section-toolbar"><label className="search"><span>⌕</span><input value={branchQuery} onChange={(event) => setBranchQuery(event.target.value)} placeholder="ค้นหาสาขา / Username" /></label><div className="toolbar-actions toolbar-actions--bulk"><button className="button button--danger-ghost" disabled={selectedBranchIds.size === 0 || deletingBranches} onClick={() => void handleDeleteBranches('selected')}>ลบที่เลือก ({selectedBranchIds.size})</button><button className="button button--danger" disabled={state.branches.length === 0 || deletingBranches} onClick={() => void handleDeleteBranches('all')}>ลบทั้งหมด</button><label className="button button--outline">นำเข้า Branch.xlsx<input hidden type="file" accept=".xlsx,.xls" onChange={handleBranchImport} /></label><button className="button button--primary" onClick={() => setEditingBranch('new')}>＋ เพิ่มผู้ใช้</button></div></div>
              <div className="data-panel"><div className="data-panel__note"><strong>บัญชีผู้ใช้สาขา {state.branches.length} บัญชี</strong><span>เลือก checkbox เพื่อลบบางบัญชี หรือใช้ปุ่มลบทั้งหมด · สาขาที่มีประวัติการจองจะลบไม่ได้</span></div><div className="data-table data-table--users"><div className="data-table__head"><span className="select-cell"><input type="checkbox" aria-label="เลือกผู้ใช้สาขาที่แสดงทั้งหมด" checked={filteredBranches.length > 0 && filteredBranches.every((branch) => selectedBranchIds.has(branch.id))} onChange={(event) => toggleVisibleBranches(event.target.checked)} /></span><span>สาขา</span><span>Username</span><span>สถานะ</span><span>จัดการ</span></div>{filteredBranches.map((branch) => <div className="data-table__row" key={branch.id}><span className="select-cell"><input type="checkbox" aria-label={`เลือก ${branch.code}`} checked={selectedBranchIds.has(branch.id)} onChange={(event) => toggleBranch(branch.id, event.target.checked)} /></span><span><strong>{branch.name}</strong><small>{branch.code}</small></span><span>{branch.username}</span><span><i className={branch.active ? 'active-pill' : 'inactive-pill'}>{branch.active ? 'ใช้งานอยู่' : 'ระงับ'}</i></span><span className="row-actions"><button className="text-button" onClick={() => setEditingBranch(branch)}>แก้ไข</button><button className="text-button text-button--orange" onClick={() => void resetPassword(branch)}>Reset 1234</button><button className="text-button text-button--red" onClick={() => void handleDeleteBranches('selected', [branch.id])}>ลบ</button></span></div>)}</div></div>
            </>
          )}

          {tab === 'schedule' && (
            <section className="settings-layout schedule-layout">
              <form className="settings-card form-stack" onSubmit={handleSchedule}>
                <div className="settings-card__intro"><div className="security-icon"><ClockIcon /></div><div><h2>ช่วงเวลาเปิดรับจอง</h2><p>เวลาอ้างอิงประเทศไทย (Asia/Bangkok)</p></div></div>
                <div className={`booking-window-status ${state.settings.bookingOpen ? 'booking-window-status--open' : ''}`}>
                  <span>{state.settings.bookingOpen ? 'เปิดรับจองอยู่' : 'ปิดรับจองอยู่'}</span>
                  <strong>{state.settings.opensAtLabel}</strong>
                </div>
                <label className="toggle-row"><span><strong>เปิดใช้งานระบบรับจอง</strong><small>เป็น Master Control และยังต้องอยู่ภายในช่วงเวลาที่กำหนด</small></span><input type="checkbox" checked={scheduleEnabled} onChange={(event) => setScheduleEnabled(event.target.checked)} /></label>
                <div className="form-grid">
                  <label><span>วันที่และเวลาเปิด</span><input type="datetime-local" value={scheduleOpensAt} onChange={(event) => setScheduleOpensAt(event.target.value)} /></label>
                  <label><span>วันที่และเวลาปิด</span><input type="datetime-local" value={scheduleClosesAt} onChange={(event) => setScheduleClosesAt(event.target.value)} /></label>
                </div>
                <div className="notice notice--warning"><strong>เมื่อถึงเวลาปิด ระบบจะหยุดรับเฉพาะรายการใหม่</strong><span>รายการเดิมยังอัปโหลดใบเสร็จ ยกเลิก และตรวจสอบได้ตามปกติ · Server ตรวจเวลาอีกครั้งตอน Submit</span></div>
                <div className="modal__actions"><button type="button" className="button button--ghost" onClick={() => { setScheduleOpensAt(''); setScheduleClosesAt('') }}>ล้างเวลาที่กำหนด</button><button type="submit" className="button button--primary" disabled={savingSchedule}>{savingSchedule ? 'กำลังบันทึก…' : 'บันทึกเวลาเปิด–ปิด'}</button></div>
              </form>
            </section>
          )}

          {tab === 'password' && (
            <section className="settings-layout">
              <form className="settings-card form-stack" onSubmit={handlePassword}>
                <div className="settings-card__intro"><div className="security-icon">⌘</div><div><h2>บัญชี Admin</h2><p>{state.admin.username} · ผู้ดูแลระบบ</p></div></div>
                <div className="notice"><strong>ความปลอดภัยของบัญชี</strong><span>กรอกรหัสผ่านปัจจุบันก่อนตั้งรหัสผ่านใหม่</span></div>
                <label><span>รหัสผ่านปัจจุบัน</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
                <label><span>รหัสผ่านใหม่</span><input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={4} required /></label>
                <label><span>ยืนยันรหัสผ่านใหม่</span><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={4} required /></label>
                <button type="submit" className="button button--primary">บันทึกรหัสผ่านใหม่</button>
              </form>
            </section>
          )}
        </main>
      </div>
      {editingProduct && (
        <ProductEditor
          product={editingProduct === 'new' ? undefined : editingProduct}
          onClose={() => setEditingProduct(null)}
          onSaved={() => {
            setEditingProduct(null)
            showToast('บันทึกข้อมูลสินค้าเรียบร้อย')
          }}
        />
      )}
      {editingBranch && (
        <BranchEditor
          branch={editingBranch === 'new' ? undefined : editingBranch}
          onClose={() => setEditingBranch(null)}
          onSaved={() => {
            setEditingBranch(null)
            showToast('บันทึกข้อมูลผู้ใช้เรียบร้อย')
          }}
        />
      )}
      {selectedReceipt && <ReceiptViewer reservation={selectedReceipt} onClose={() => setSelectedReceipt(null)} />}
      {toast && <Toast {...toast} />}
    </div>
  )
}
