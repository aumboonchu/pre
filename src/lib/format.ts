export const currency = (value: number) =>
  new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 0,
  }).format(value)

export const dateTime = (value: string) =>
  new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))

export const timeRemaining = (expiresAt: string) => {
  const milliseconds = new Date(expiresAt).getTime() - Date.now()
  if (milliseconds <= 0) return 'หมดเวลาแล้ว'
  const hours = Math.floor(milliseconds / 3_600_000)
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000)
  return `${hours} ชม. ${minutes} นาที`
}

export const cleanProductName = (name: string) => name.replace(/^IP\d+-/, '').replace(/\s+1-Y$/, '')

export const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('อ่านไฟล์รูปภาพไม่สำเร็จ'))
    reader.readAsDataURL(file)
  })
