import type { BranchUser, Product, Reservation } from '../types'

type Row = Record<string, unknown>

const value = (row: Row, keys: string[]) => {
  const match = keys.find((key) => row[key] !== undefined && row[key] !== '')
  return match ? row[match] : undefined
}

const rowsFromFile = async (file: File): Promise<Row[]> => {
  const XLSX = await import('xlsx')
  const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error('ไม่พบ Sheet ในไฟล์ Excel')
  return XLSX.utils.sheet_to_json<Row>(sheet, { defval: '' })
}

export async function readProductsExcel(file: File): Promise<Product[]> {
  const rows = await rowsFromFile(file)
  const products = rows
    .map((row): Product | null => {
      const sku = String(value(row, ['Product', 'SKU', 'Part Number', 'PartNumber']) ?? '').trim()
      const name = String(value(row, ['Product Name', 'Name', 'สินค้า']) ?? '').trim()
      const price = Number(value(row, ['Sell Price', 'Price', 'ราคา']) ?? 0)
      const stock = Number(value(row, ['Stock', 'จำนวน Stock', 'Total Stock']) ?? 0)
      if (!sku || !name) return null
      return {
        id: sku,
        sku,
        name,
        price: Number.isFinite(price) ? price : 0,
        totalStock: Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : 0,
        remainingStock: Number.isFinite(stock) ? Math.max(0, Math.floor(stock)) : 0,
        active: true,
      } satisfies Product
    })
    .filter((item): item is Product => item !== null)

  if (!products.length) {
    throw new Error('ไม่พบคอลัมน์ Product และ Product Name ในไฟล์')
  }
  return products
}

export async function readBranchesExcel(file: File): Promise<BranchUser[]> {
  const rows = await rowsFromFile(file)
  const branches = rows
    .map((row): BranchUser | null => {
      const rawId = String(value(row, ['ID', 'Branch ID', 'รหัสสาขา']) ?? '').trim()
      const name = String(value(row, ['Name', 'Branch Name', 'ชื่อสาขา']) ?? '').trim()
      if (!rawId || !name) return null
      const id = rawId.replace(/^JIB-/i, '')
      const username = String(value(row, ['Username', 'User']) ?? `jib${id}`).trim()
      return {
        id,
        code: `JIB-${id}`,
        name,
        username,
        password: '1234',
        active: true,
      } satisfies BranchUser
    })
    .filter((item): item is BranchUser => item !== null)

  if (!branches.length) throw new Error('ไม่พบคอลัมน์ ID และ Name ในไฟล์')
  return branches
}

export function buildReservationExportRows(
  reservations: Reservation[],
  products: Product[],
  branches: BranchUser[],
) {
  return reservations.map((reservation) => {
    const product = products.find((item) => item.id === reservation.productId)
    const branch = branches.find((item) => item.id === reservation.branchId)
    return {
      'เลขที่การจอง': reservation.id,
      'วันที่จอง': new Date(reservation.createdAt),
      'รหัสสาขา': branch?.code ?? reservation.branchId,
      'ชื่อสาขา': branch?.name ?? '',
      'Part Number': product?.sku ?? reservation.productId,
      'ชื่อสินค้า': product?.name ?? '',
      'ราคา (บาท)': product?.price ?? 0,
      'ชื่อลูกค้า': reservation.customerName,
      'เบอร์โทร': reservation.customerPhone,
      'สถานะการจอง': reservation.status,
      'สถานะใบเสร็จ': reservation.receipt ? 'แนบแล้ว' : 'ยังไม่แนบ',
      'วันที่อัปโหลดใบเสร็จ': reservation.receipt
        ? new Date(reservation.receipt.uploadedAt)
        : '',
      'เวลาหมดสิทธิ์': new Date(reservation.expiresAt),
      'เหตุผลยกเลิก': reservation.cancelReason ?? '',
    }
  })
}

export async function exportReservationsExcel(
  reservations: Reservation[],
  products: Product[],
  branches: BranchUser[],
): Promise<void> {
  const XLSX = await import('xlsx')
  const rows = buildReservationExportRows(reservations, products, branches)
  const sheet = XLSX.utils.json_to_sheet(rows, { cellDates: true })
  sheet['!cols'] = [
    { wch: 28 }, { wch: 21 }, { wch: 14 }, { wch: 30 },
    { wch: 18 }, { wch: 42 }, { wch: 14 }, { wch: 25 },
    { wch: 16 }, { wch: 24 }, { wch: 18 }, { wch: 24 },
    { wch: 21 }, { wch: 30 },
  ]
  sheet['!autofilter'] = { ref: sheet['!ref'] ?? 'A1:N1' }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Reservations')
  const stamp = new Date().toISOString().slice(0, 10)
  XLSX.writeFileXLSX(workbook, `reservation-report-${stamp}.xlsx`, {
    compression: true,
    cellDates: true,
  })
}
