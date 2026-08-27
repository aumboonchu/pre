# JIB Pre-Interest / Pre-Order

ระบบจองสินค้าล่วงหน้าสำหรับสาขา JIB แบบ Full-stack พัฒนาด้วย React, Cloudflare Workers, D1 และ Workers KV โดยใช้ข้อมูลตั้งต้นจาก `pre order.xlsx` และ `Branch.xlsx` และแก้ไขข้อมูลภายหลังได้จากหน้า Admin

## บัญชีเริ่มต้น

- สาขา: `JIB-284` / `1234` (หรือ Username `jib284`)
- Admin: `admin` / รหัสเริ่มต้นที่ส่งให้เจ้าของระบบหลัง Deploy

บัญชีสาขาทุกบัญชีใช้รหัสผ่านเริ่มต้น `1234` และ Admin สามารถ Reset รหัสของสาขากลับเป็น `1234` ได้ ควรเปลี่ยนรหัสผ่าน Admin และบัญชีใช้งานจริงทันทีหลัง Deploy ระบบเริ่มต้นโดยปิดรับจองจนกว่า Admin จะตรวจ Stock และกดเปิด

## ฟังก์ชันหลัก

### Branch Portal

- Login ด้วยรหัสสาขา, Branch Code หรือ Username
- จองครั้งละ 1 เครื่อง แต่มีรายการจองหลายรายการได้
- บังคับกรอกชื่อลูกค้าและเบอร์โทร
- แนบใบเสร็จตอนจองหรือภายใน 72 ชั่วโมง รองรับ JPG, PNG, HEIC และ HEIF ไม่เกิน 10 MB
- ดูสถานะ `Waiting for Approved`, `Confirmed` และ `Cancel`
- ยกเลิกเองได้ โดยระบบคืน Stock เพียงครั้งเดียว
- เปลี่ยนรหัสผ่านได้

### Admin Portal

- Dashboard สรุปรายการจองและ Stock คงเหลือ
- ตรวจใบเสร็จ อนุมัติ หรือยกเลิกรายการ
- Import และแก้ไข Product/Part Number, ราคา และ Stock
- Import และแก้ไขผู้ใช้สาขา พร้อม Reset Password เป็น `1234`
- เปิดหรือปิดรับจอง
- Report ภายในเว็บไซต์ ไม่มี Email, LINE หรือ Push Notification

## ป้องกันการจองเกิน Stock

ฐานข้อมูลเป็นผู้ตัดสินสิทธิ์สุดท้าย ไม่พึ่งค่าจากหน้าจอ:

- Trigger ของ D1 ตรวจ Stock, หัก 1 เครื่อง และสร้างรายการในคำสั่งฐานข้อมูลเดียว
- Constraint บังคับ `remaining_stock >= 0`; หนึ่งแถว reservation แทนหนึ่งเครื่องโดยไม่มี quantity ที่ client เปลี่ยนได้
- Unique Idempotency Key ต่อสาขา ป้องกันการ Submit ซ้ำ
- การ Cancel หรือหมดเวลาเปลี่ยนสถานะและคืน Stock ด้วย Trigger ที่ทำงานเฉพาะครั้งแรก
- Cron ทำงานทุก 15 นาทีเพื่อยกเลิกรายการที่ไม่มีใบเสร็จเกิน 72 ชั่วโมง

ชุดทดสอบจำลอง Stock 5 กับ 20 คำขอพร้อมกันต้องสำเร็จ 5 รายการ, Sold out 15 รายการ และ Stock คงเหลือ 0

## สถาปัตยกรรม

- React + Vite: หน้า Branch และ Admin
- Cloudflare Worker: API, session, validation และ scheduled cleanup
- Cloudflare D1: ผู้ใช้ สินค้า Stock รายการจอง และ audit log
- Cloudflare Workers KV: เก็บรูปใบเสร็จแบบ private; อ่านได้ผ่าน API ที่ตรวจ session เท่านั้น
- PBKDF2-SHA256: เก็บรหัสผ่านแบบ salt + hash
- Session cookie: `HttpOnly`, `Secure` และ `SameSite=Lax`

## เริ่มใช้งานในเครื่อง

ต้องใช้ Node.js 20.19 ขึ้นไปและ pnpm

```bash
pnpm install
pnpm db:migrate:local
pnpm dev:worker
```

`pnpm dev` ใช้สำหรับตรวจ UI แบบ mock/localStorage ส่วน `pnpm dev:worker` เปิด Full-stack พร้อม API และฐานข้อมูล local

## ตรวจคุณภาพโค้ด

```bash
pnpm lint
pnpm test
pnpm test:worker
pnpm build
```

## Deploy Cloudflare

ไฟล์ `wrangler.jsonc` ผูก D1 และ KV ของโปรเจกต์ไว้แล้ว

```bash
pnpm exec wrangler login
pnpm exec wrangler d1 migrations apply jib-pre-interest-db --remote
pnpm deploy
```

รายละเอียด API และกติกาความถูกต้องอยู่ที่ [docs/API_CONTRACT.md](docs/API_CONTRACT.md)
