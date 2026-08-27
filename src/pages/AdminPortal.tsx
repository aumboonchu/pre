import { type ChangeEvent, type FormEvent, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Brand, EmptyState, Modal, StatusBadge, Toast } from '../components/Common'
import { useToast } from '../hooks/useToast'
import { readBranchesExcel, readProductsExcel } from '../lib/excel'
import { cleanProductName, currency, dateTime } from '../lib/format'
import { useAppStore } from '../store/AppStore'
import type { BranchUser, Product, ReservationStatus } from '../types'

type AdminTab = 'overview' | 'reservations' | 'products' | 'users'

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
    importBranches,
    resetBranchPassword,
    setBookingOpen,
  } = useAppStore()
  const { toast, showToast } = useToast()
  const [tab, setTab] = useState<AdminTab>('overview')
  const [reservationFilter, setReservationFilter] = useState<'All' | ReservationStatus>('Waiting for Approved')
  const [productQuery, setProductQuery] = useState('')
  const [branchQuery, setBranchQuery] = useState('')
  const [editingProduct, setEditingProduct] = useState<Product | 'new' | null>(null)
  const [editingBranch, setEditingBranch] = useState<BranchUser | 'new' | null>(null)

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
      showToast(open ? 'เปิดรับจองแล้ว' : 'ปิดรับจองแล้ว')
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : 'เปลี่ยนสถานะระบบไม่สำเร็จ', 'error')
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

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Brand compact />
        <div className="admin-sidebar__label">ADMIN CONSOLE</div>
        <nav>
          <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}><span>▦</span> Dashboard</button>
          <button className={tab === 'reservations' ? 'active' : ''} onClick={() => setTab('reservations')}><span>✓</span> ตรวจสอบการจอง <b>{waiting}</b></button>
          <button className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}><span>□</span> สินค้าและ Stock</button>
          <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}><span>♙</span> ผู้ใช้สาขา</button>
        </nav>
        <div className="admin-sidebar__safety"><strong>Stock-safe mode</strong><span>Atomic transaction</span><span>Idempotency key</span><span>72h stock restore</span></div>
        <button className="sidebar-logout" onClick={logout} type="button">ออกจากระบบ</button>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <div><span className="eyebrow eyebrow--orange">HQ / OPERATIONS PORTAL</span><h1>{tab === 'overview' ? 'ภาพรวมระบบ' : tab === 'reservations' ? 'ตรวจสอบการจอง' : tab === 'products' ? 'สินค้าและ Stock' : 'ผู้ใช้รายสาขา'}</h1></div>
          <div className="admin-topbar__actions">
            <label className="system-switch"><span><strong>{state.settings.bookingOpen ? 'ระบบเปิดรับจอง' : 'ระบบปิดรับจอง'}</strong><small>{state.settings.opensAtLabel}</small></span><input type="checkbox" checked={state.settings.bookingOpen} onChange={(event) => void changeBookingSetting(event.target.checked)} /></label>
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
              <section className="safeguard-banner"><div><span>⚡</span><div><strong>Race Condition Defenses พร้อมทำงานจริง</strong><p>Database หัก Stock แบบ Atomic และบังคับ Unique Idempotency Key จึงไม่รับจองเกินแม้สาขากดพร้อมกัน</p></div></div><div className="safeguard-tags"><span>Atomic Stock</span><span>Idempotency</span><span>Server Time 20:00</span><span>72h Restore</span></div></section>
            </>
          )}

          {tab === 'reservations' && (
            <>
              <div className="section-toolbar"><div className="filter-tabs">{(['All', 'Waiting for Approved', 'Confirmed', 'Cancel'] as const).map((status) => <button key={status} className={reservationFilter === status ? 'active' : ''} onClick={() => setReservationFilter(status)}>{status}{status === 'Waiting for Approved' && <b>{waiting}</b>}</button>)}</div><span>แสดง {filteredReservations.length} รายการ</span></div>
              {filteredReservations.length === 0 ? <EmptyState title="ไม่พบรายการจอง" description="ลองเลือกตัวกรองสถานะอื่น" /> : <section className="review-grid">{filteredReservations.map((reservation) => { const branch = state.branches.find((item) => item.id === reservation.branchId); const product = state.products.find((item) => item.id === reservation.productId); return <article className="review-card" key={reservation.id}><div className="review-card__receipt">{reservation.receipt && reservation.receipt.type !== 'image/heic' ? <img src={reservation.receipt.dataUrl} alt={`ใบเสร็จ ${reservation.id}`} /> : <div><span>▧</span><strong>{reservation.receipt ? 'HEIC receipt' : 'ยังไม่มีใบเสร็จ'}</strong><small>{reservation.receipt?.name ?? 'รออัปโหลดภายใน 72 ชม.'}</small></div>}</div><div className="review-card__body"><div className="review-card__heading"><div><span className="eyebrow">{reservation.id}</span><h3>{product ? cleanProductName(product.name) : reservation.productId}</h3><p>{product?.sku}</p></div><StatusBadge status={reservation.status} /></div><dl><div><dt>สาขา</dt><dd>{branch?.name}<small>{branch?.code}</small></dd></div><div><dt>ลูกค้า</dt><dd>{reservation.customerName}<small>{reservation.customerPhone}</small></dd></div><div><dt>วันที่จอง</dt><dd>{dateTime(reservation.createdAt)}</dd></div></dl>{reservation.status === 'Waiting for Approved' && <div className="review-card__actions"><button className="button button--danger" onClick={() => rejectItem(reservation.id)} disabled={!reservation.receipt}>ไม่อนุมัติ</button><button className="button button--success" onClick={() => approveItem(reservation.id)} disabled={!reservation.receipt}>อนุมัติ / ยืนยัน</button></div>}{!reservation.receipt && reservation.status === 'Waiting for Approved' && <p className="review-hint">ยังดำเนินการไม่ได้จนกว่าสาขาจะอัปโหลดใบเสร็จ</p>}</div></article>})}</section>}
            </>
          )}

          {tab === 'products' && (
            <>
              <div className="section-toolbar"><label className="search"><span>⌕</span><input value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="ค้นหา Product / Part Number" /></label><div className="toolbar-actions"><label className="button button--outline">นำเข้า Excel .xlsx<input hidden type="file" accept=".xlsx,.xls" onChange={handleProductImport} /></label><button className="button button--primary" onClick={() => setEditingProduct('new')}>＋ เพิ่มสินค้า</button></div></div>
              <div className="data-panel"><div className="data-panel__note"><strong>ข้อมูลตั้งต้นจาก pre order.xlsx</strong><span>รองรับคอลัมน์ Product, Product Name, Sell Price และ Stock (ถ้ามี) · Stock เดิมจะถูกเก็บไว้เมื่อ Import ซ้ำ</span></div><div className="data-table data-table--products"><div className="data-table__head"><span>สินค้า / Part Number</span><span>ราคา</span><span>Stock ทั้งหมด</span><span>จองแล้ว</span><span>คงเหลือ</span><span>สถานะ</span><span /></div>{filteredProducts.map((product) => { const booked = product.totalStock - product.remainingStock; return <div className="data-table__row" key={product.id}><span><strong>{cleanProductName(product.name)}</strong><small>{product.sku}</small></span><span>{currency(product.price)}</span><span>{product.totalStock}</span><span>{booked}</span><span className={product.remainingStock > 0 ? 'green' : 'red'}><strong>{product.remainingStock}</strong></span><span><i className={product.active ? 'active-pill' : 'inactive-pill'}>{product.active ? 'เปิดจอง' : 'ปิด'}</i></span><span><button className="text-button" onClick={() => setEditingProduct(product)}>แก้ไข</button></span></div>})}</div></div>
            </>
          )}

          {tab === 'users' && (
            <>
              <div className="section-toolbar"><label className="search"><span>⌕</span><input value={branchQuery} onChange={(event) => setBranchQuery(event.target.value)} placeholder="ค้นหาสาขา / Username" /></label><div className="toolbar-actions"><label className="button button--outline">นำเข้า Branch.xlsx<input hidden type="file" accept=".xlsx,.xls" onChange={handleBranchImport} /></label><button className="button button--primary" onClick={() => setEditingBranch('new')}>＋ เพิ่มผู้ใช้</button></div></div>
              <div className="data-panel"><div className="data-panel__note"><strong>บัญชีผู้ใช้สาขา {state.branches.length} บัญชี</strong><span>ผู้ใช้ใหม่มีรหัสผ่านเริ่มต้น 1234 · ไม่มีการส่งแจ้งเตือนภายนอก</span></div><div className="data-table data-table--users"><div className="data-table__head"><span>สาขา</span><span>Username</span><span>สถานะ</span><span>จัดการ</span></div>{filteredBranches.map((branch) => <div className="data-table__row" key={branch.id}><span><strong>{branch.name}</strong><small>{branch.code}</small></span><span>{branch.username}</span><span><i className={branch.active ? 'active-pill' : 'inactive-pill'}>{branch.active ? 'ใช้งานอยู่' : 'ระงับ'}</i></span><span className="row-actions"><button className="text-button" onClick={() => setEditingBranch(branch)}>แก้ไข</button><button className="text-button text-button--orange" onClick={() => void resetPassword(branch)}>Reset 1234</button></span></div>)}</div></div>
            </>
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
      {toast && <Toast {...toast} />}
    </div>
  )
}
