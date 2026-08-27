# Production API Contract

API ใช้ session cookie แบบ `HttpOnly` และตอบ JSON รูปแบบ `{ "ok": true, ... }` หรือ `{ "ok": false, "code": "...", "message": "..." }` ทุกคำสั่งที่เปลี่ยนข้อมูลตรวจ Same-Origin ฝั่ง Worker

## Authentication

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/session`
- `POST /api/v1/auth/change-password`

รหัสผ่านจัดเก็บแบบ PBKDF2-SHA256 พร้อม random salt และ token ของ session จัดเก็บใน D1 เฉพาะค่า hash

## State

`GET /api/v1/state` คืนข้อมูลตามสิทธิ์ของ session ปัจจุบัน สาขาเห็นเฉพาะรายการของตนเอง ส่วน Admin เห็นข้อมูลรวม ผู้ใช้ สินค้า และรายการจองทั้งหมด

## Create reservation

`POST /api/v1/reservations`

Headers:

```http
Idempotency-Key: <uuid-per-submit>
Content-Type: application/json
```

Body:

```json
{
  "productId": "MFYW4ZP/A",
  "customerName": "ลูกค้าทดสอบ",
  "customerPhone": "0812345678"
}
```

กติกา:

1. ใช้เวลา Server ตรวจว่าเปิดรับจองแล้ว
2. หนึ่งคำขอเท่ากับหนึ่งเครื่อง และสาขาสร้างหลายรายการได้
3. `(branch_id, idempotency_key)` ต้องไม่ซ้ำ; retry key เดิมคืน reservation เดิมโดยไม่หัก Stock ซ้ำ
4. D1 `BEFORE INSERT` trigger ตรวจและหัก Stock ใน statement เดียวกับการสร้าง reservation
5. Stock เป็นศูนย์หรือสินค้าไม่ active จะ abort และตอบ `409 SOLD_OUT`
6. identity ของสาขามาจาก session เท่านั้น ไม่รับ branch id จาก client

Responses สำคัญ:

- `201 Created`: สร้างรายการสำเร็จ
- `200 OK`: replay จาก Idempotency Key เดิม
- `409 BOOKING_CLOSED`: ยังไม่เปิดรับจอง
- `409 SOLD_OUT`: Stock หมด
- `400 VALIDATION_ERROR`: ข้อมูลไม่ครบหรือไม่ถูกต้อง

## Receipt

- `POST /api/v1/reservations/:id/receipt`: multipart field ชื่อ `receipt`
- `GET /api/v1/reservations/:id/receipt`: อ่านได้เฉพาะสาขาเจ้าของรายการหรือ Admin
- รองรับ JPG, PNG, HEIC และ HEIF ไม่เกิน 10 MB
- ไฟล์เก็บใน private Workers KV; D1 เก็บ object key, ชื่อ, MIME type และเวลาอัปโหลด
- อัปโหลดได้เฉพาะรายการของสาขาตนเองที่ยังรอตรวจสอบและยังไม่ครบ 72 ชั่วโมง

## Reservation status

- `POST /api/v1/reservations/:id/cancel`: สาขายกเลิกของตนเอง
- `POST /api/v1/admin/reservations/:id/status`: Admin ส่ง `Confirmed` หรือ `Cancel`

D1 `AFTER UPDATE` trigger คืน Stock เฉพาะ transition ครั้งแรกจากสถานะที่ไม่ใช่ `Cancel` ไปเป็น `Cancel` ดังนั้นคำสั่งซ้ำไม่คืน Stock ซ้ำ

## Admin

- `PUT /api/v1/admin/products/:id`
- `POST /api/v1/admin/products/import`
- `PUT /api/v1/admin/branches/:id`
- `POST /api/v1/admin/branches/import`
- `POST /api/v1/admin/branches/:id/reset-password`
- `POST /api/v1/admin/settings/booking`

การปรับ Stock ห้ามตั้ง total ต่ำกว่าจำนวนที่ถูกจองอยู่ เพื่อรักษาสมการ `remaining = total - reserved`

## 72-hour expiry

Cron Trigger ทำงานทุก 15 นาที และ API state/create จะตรวจ expiry เพิ่มเติม รายการ `Waiting for Approved` ที่ไม่มีใบเสร็จและครบ 72 ชั่วโมงจะเปลี่ยนเป็น `Cancel`; trigger เดียวกันคืน Stock เพียงครั้งเดียว

## Database safeguards

- `CHECK (remaining_stock >= 0 AND remaining_stock <= total_stock)`
- หนึ่งแถว reservation แทนหนึ่งเครื่อง ไม่มี quantity ที่ client เปลี่ยนได้
- `UNIQUE (branch_id, idempotency_key)`
- Foreign keys ระหว่าง reservation, product และ branch
- Audit event สำหรับการจอง, ยกเลิก, อนุมัติ, upload, import, reset password และเปลี่ยน setting
