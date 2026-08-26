# Production API Contract

เอกสารนี้กำหนดพฤติกรรมขั้นต่ำของ Backend เพื่อไม่ให้เกิด Overselling เมื่อสาขาทั่วประเทศกด Submit พร้อมกันเวลา 20:00 น.

## Create reservation

`POST /api/v1/reservations`

Headers:

```http
Idempotency-Key: <uuid-per-submit>
Authorization: Bearer <branch-session>
```

Body:

```json
{
  "productId": "MFYW4ZP/A",
  "customerName": "ลูกค้าทดสอบ",
  "customerPhone": "0812345678",
  "quantity": 1
}
```

Rules:

1. Backend ใช้เวลา Server ตรวจรอบเปิดจอง ห้ามเชื่อเวลา Browser
2. `quantity` ต้องเท่ากับ 1
3. `Idempotency-Key` ต้อง unique ต่อ branch และคืน response เดิมเมื่อ retry key เดิม
4. หัก Stock และสร้าง reservation ใน transaction เดียว
5. ถ้า Stock เป็น 0 ต้องไม่สร้าง reservation และตอบ `409 SOLD_OUT`

ตัวอย่าง transaction (แนวทาง):

```sql
BEGIN;

SELECT response_body
FROM idempotency_keys
WHERE branch_id = :branch_id AND key = :idempotency_key
FOR UPDATE;

UPDATE products
SET remaining_stock = remaining_stock - 1
WHERE id = :product_id
  AND active = TRUE
  AND remaining_stock > 0
RETURNING remaining_stock;

-- ถ้า UPDATE ได้ 0 row: ROLLBACK และตอบ 409 SOLD_OUT

INSERT INTO reservations (..., quantity, status, expires_at)
VALUES (..., 1, 'Waiting for Approved', NOW() + INTERVAL '72 hours');

INSERT INTO idempotency_keys (...);
COMMIT;
```

Responses:

- `201 Created` สร้างรายการสำเร็จ
- `200 OK` replay จาก Idempotency Key เดิม
- `409 Conflict` `{ "code": "SOLD_OUT" }`
- `425 Too Early` `{ "code": "BOOKING_NOT_OPEN" }`
- `422 Unprocessable Entity` ข้อมูลลูกค้าไม่ครบหรือ quantity ไม่ใช่ 1

## Receipt

- `POST /api/v1/reservations/:id/receipt` ใช้ multipart upload
- รองรับ JPG, PNG, HEIC และตรวจชนิดไฟล์จริงฝั่ง Server
- จัดเก็บ object storage; Database เก็บ metadata และ object key
- สาขาแก้ไขได้เฉพาะ reservation ของตนเองที่ยังไม่ `Cancel`

## Approve / reject / cancel

- `POST /api/v1/admin/reservations/:id/confirm`
- `POST /api/v1/admin/reservations/:id/reject`
- `POST /api/v1/reservations/:id/cancel`

การ reject/cancel ต้อง lock reservation row, เปลี่ยนสถานะ และเพิ่ม Stock 1 ใน transaction เดียว การเรียกซ้ำห้ามคืน Stock ซ้ำ

## 72-hour expiry worker

Worker เลือก reservation ที่ `status = 'Waiting for Approved'`, ไม่มี receipt และ `expires_at <= NOW()` ด้วย `FOR UPDATE SKIP LOCKED` จากนั้นเปลี่ยนเป็น `Cancel` และคืน Stock ภายใน transaction เดียว ควรมี unique stock-ledger reference ต่อ reservation เพื่อป้องกันคืนซ้ำ

## Database constraints

- `CHECK (remaining_stock >= 0)`
- `CHECK (quantity = 1)`
- `UNIQUE (branch_id, idempotency_key)`
- `UNIQUE (reservation_id, ledger_type)` สำหรับ stock restore
- ทุก API ใช้ branch identity จาก session/token ไม่รับ branch id จาก client เป็นผู้ตัดสินสิทธิ์

Frontend ต้องแสดงข้อความจาก error code, disable ปุ่มระหว่าง request และ refresh Stock หลัง `409` แต่ข้อป้องกันเหล่านี้ไม่ทดแทน transaction ฝั่ง Backend
