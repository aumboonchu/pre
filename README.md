# JIB Pre-Interest / Pre-Order

Frontend สำหรับระบบจองสินค้าล่วงหน้าของสาขา JIB ออกแบบจาก Figma และใช้ข้อมูลตั้งต้นจากไฟล์ `pre order.xlsx` และ `Branch.xlsx`

## บัญชีทดสอบ

- สาขา: `JIB-284` / `1234` (หรือใช้ `jib284`)
- Admin: `admin` / `1234`

ผู้ใช้สาขาทุกบัญชีจาก Excel มีรหัสผ่านเริ่มต้น `1234` และ Admin สามารถ Reset กลับเป็น `1234` ได้

## ฟังก์ชันที่พัฒนาแล้ว

### Branch Portal

- Login ด้วยรหัสสาขา, Branch Code หรือ Username
- จองสินค้าได้ครั้งละ 1 เครื่อง และสร้างหลายรายการได้
- บังคับกรอกชื่อลูกค้าและเบอร์โทร
- แนบใบเสร็จตอนจองหรือภายหลัง รองรับ JPG, PNG และ HEIC
- แสดงสถานะ `Waiting for Approved`, `Confirmed`, `Cancel`
- ยกเลิกจองเอง พร้อมคืน Stock
- หมดสิทธิ์และคืน Stock อัตโนมัติเมื่อไม่มีใบเสร็จภายใน 72 ชั่วโมง
- เปลี่ยนรหัสผ่าน

### Admin Portal

- Dashboard สรุปรายการจองและ Stock คงเหลือ
- ตรวจใบเสร็จ อนุมัติ หรือไม่อนุมัติรายการ
- Import Product/Part Number จาก Excel และแก้ไข Stock รายสินค้า
- Import/แก้ไขผู้ใช้สาขา และ Reset Password เป็น `1234`
- เปิด/ปิดรับจองจากหน้า Admin
- Report ภายในเว็บไซต์เท่านั้น ไม่มี Email, LINE หรือ Push Notification

## Race-condition safeguards

โหมด Frontend prototype ใช้ Web Locks + serial fallback, re-read state ก่อนหัก Stock, Idempotency Key ต่อ Submit, ปิดปุ่มขณะส่ง และคืน Stock แบบ idempotent เมื่อยกเลิก/หมดเวลา

> Production ต้องให้ Backend และ Database เป็นผู้ตัดสินสิทธิ์สุดท้าย ดูรายละเอียดที่ [docs/API_CONTRACT.md](docs/API_CONTRACT.md)

กรณีทดสอบ Stock 5 กับ 20 คำขอพร้อมกันอยู่ใน `src/lib/reservationEngine.test.ts` และต้องได้ผลสำเร็จ 5 รายการ, Sold out 15 รายการ, Stock คงเหลือ 0

## เริ่มใช้งาน

ต้องใช้ Node.js 20.19+ ตามข้อกำหนดของ Vite

```bash
pnpm install
pnpm dev
```

ตรวจคุณภาพโค้ด:

```bash
pnpm lint
pnpm test
pnpm build
```

## หมายเหตุการเชื่อม Backend

เวอร์ชันนี้เป็น Frontend repository จึงเก็บข้อมูลจำลองใน Browser local storage เพื่อให้ตรวจ UX และ workflow ได้ครบ เมื่อ Backend พร้อมให้แทนที่ action ใน `src/store/AppStore.tsx` ด้วย API ตาม contract โดยคง validation และสถานะ UI เดิมไว้
