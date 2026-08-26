import type { BranchUser, Product } from '../types'

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
