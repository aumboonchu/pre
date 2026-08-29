import type { AppState, BranchUser, Product } from '../types'

const productRows: Array<[string, string, number]> = [
  ['MFYW4ZP/A', 'IP532-Apple iPhone 17 Pro Max 1TB Cosmic Orange 1-Y', 64900],
  ['MFYM4ZP/A', 'IP525-Apple iPhone 17 Pro Max 256GB Silver 1-Y', 48900],
  ['MFYN4ZP/A', 'IP526-Apple iPhone 17 Pro Max 256GB Cosmic Orange 1-Y', 48900],
  ['MFYP4ZP/A', 'IP527-Apple iPhone 17 Pro Max 256GB Deep Blue 1-Y', 48900],
  ['MFYQ4ZP/A', 'IP528-Apple iPhone 17 Pro Max 512GB Silver 1-Y', 56900],
  ['MFYT4ZP/A', 'IP529-Apple iPhone 17 Pro Max 512GB Cosmic Orange 1-Y', 56900],
  ['MFYU4ZP/A', 'IP530-Apple iPhone 17 Pro Max 512GB Deep Blue 1-Y', 56900],
  ['MFYV4ZP/A', 'IP531-Apple iPhone 17 Pro Max 1TB Silver 1-Y', 64900],
  ['MFYX4ZP/A', 'IP533-Apple iPhone 17 Pro Max 1TB Deep Blue 1-Y', 64900],
  ['MFYY4ZP/A', 'IP534-Apple iPhone 17 Pro Max 2TB Silver 1-Y', 80900],
  ['MG004ZP/A', 'IP535-Apple iPhone 17 Pro Max 2TB Cosmic Orange 1-Y', 80900],
  ['MG014ZP/A', 'IP536-Apple iPhone 17 Pro Max 2TB Deep Blue 1-Y', 80900],
  ['MG8G4ZP/A', 'IP537-Apple iPhone 17 Pro 256GB Silver 1-Y', 43900],
  ['MG8H4ZP/A', 'IP538-Apple iPhone 17 Pro 256GB Cosmic Orange 1-Y', 43900],
  ['MG8J4ZP/A', 'IP539-Apple iPhone 17 Pro 256GB Deep Blue 1-Y', 43900],
  ['MG8K4ZP/A', 'IP540-Apple iPhone 17 Pro 512GB Silver 1-Y', 51900],
  ['MG8M4ZP/A', 'IP541-Apple iPhone 17 Pro 512GB Cosmic Orange 1-Y', 51900],
  ['MG8N4ZP/A', 'IP542-Apple iPhone 17 Pro 512GB Deep Blue 1-Y', 51900],
  ['MG8P4ZP/A', 'IP543-Apple iPhone 17 Pro 1TB Silver 1-Y', 59900],
  ['MG8Q4ZP/A', 'IP544-Apple iPhone 17 Pro 1TB Cosmic Orange 1-Y', 59900],
  ['MG8R4ZP/A', 'IP545-Apple iPhone 17 Pro 1TB Deep Blue 1-Y', 59900],
  ['MG6J4ZP/A', 'IP558-Apple iPhone 17 256GB Black 1-Y', 29900],
  ['MG6K4ZP/A', 'IP559-Apple iPhone 17 256GB White 1-Y', 29900],
  ['MG6L4ZP/A', 'IP560-Apple iPhone 17 256GB Mist Blue 1-Y', 29900],
  ['MG6M4ZP/A', 'IP561-Apple iPhone 17 256GB Lavender 1-Y', 29900],
  ['MG6N4ZP/A', 'IP562-Apple iPhone 17 256GB Sage 1-Y', 29900],
  ['MG6P4ZP/A', 'IP563-Apple iPhone 17 512GB Black 1-Y', 37900],
  ['MG6Q4ZP/A', 'IP564-Apple iPhone 17 512GB White 1-Y', 37900],
  ['MG6T4ZP/A', 'IP565-Apple iPhone 17 512GB Mist Blue 1-Y', 37900],
  ['MG6U4ZP/A', 'IP566-Apple iPhone 17 512GB Lavender 1-Y', 37900],
  ['MG6V4ZP/A', 'IP567-Apple iPhone 17 512GB Sage 1-Y', 37900],
]

const branchRows: Array<[number, string]> = [
  [284, 'สาขา เซ็นทรัล Westville'],
  [286, 'สาขา เซ็นทรัล นครสวรรค์'],
  [287, 'สาขา เซียร์ เมกก้าช็อป E-TAX'],
  [288, 'สาขา เซ็นทรัล นครปฐม'],
  [289, 'สาขา กาฬสินธุ์ (CB)'],
  [291, 'สาขา เชียงใหม่ (Online)'],
  [292, 'สาขา ขอนแก่น (Online)'],
  [293, 'สาขา เดอะมอลล์โคราช (Online)'],
  [294, 'สาขา พัทยา (ตึกคอม) (Online)'],
  [295, 'สาขา สงขลา-หาดใหญ่ (Online)'],
  [296, 'สาขา JIB ONSITE SERVICE'],
  [297, 'สาขา JIB Mobile - Fashion Island'],
  [298, 'สาขา เซ็นทรัล พาร์ค'],
  [299, 'สาขา บึงกาฬ (CB)'],
  [300, 'สาขา ตราด (CB)'],
  [301, 'สาขา เซ็นทรัล กระบี่'],
  [302, 'สาขา ตาก (CB)'],
  [303, 'สาขา น่าน (CB)'],
  [306, 'สาขา หนองบัวลำภู (CB)'],
  [307, 'สาขา JIB Mobile เซ็นทรัลปิ่นเกล้า'],
  [309, 'สาขา เซ็นทรัลขอนแก่น แคมปัส'],
  [310, 'สาขา เซ็นทรัล Northville'],
]

export const seedProducts: Product[] = productRows.map(([sku, name, price], index) => {
  const totalStock = index < 8 ? 5 : 0
  return {
    id: sku,
    sku,
    name,
    price,
    totalStock,
    remainingStock: totalStock,
    active: true,
  }
})

export const seedBranches: BranchUser[] = branchRows.map(([id, name]) => ({
  id: String(id),
  code: `JIB-${id}`,
  name,
  username: `jib${id}`,
  password: '1234',
  active: true,
}))

export const createSeedState = (): AppState => ({
  schemaVersion: 1,
  products: structuredClone(seedProducts),
  branches: structuredClone(seedBranches),
  reservations: [],
  admin: { username: 'admin', password: '1234' },
  settings: {
    bookingEnabled: true,
    bookingOpen: true,
    opensAt: null,
    closesAt: null,
    opensAtLabel: 'เปิดรับจองทันที',
    timeZone: 'Asia/Bangkok',
  },
})
