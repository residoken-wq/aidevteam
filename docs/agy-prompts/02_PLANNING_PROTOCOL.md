# 02 — Planning: Kế hoạch triển khai (bước B2)

> Dán sau khi người đã trả lời câu hỏi ở bước 01. AGY **vẫn chưa viết code**.

```text
# NHIỆM VỤ: LẬP KẾ HOẠCH TRIỂN KHAI {{TASK_ID}}
Đầu vào: kết quả bước 01 + câu trả lời của người:
{{ANSWERS}}

Chưa viết code. Trả lời theo cấu trúc:

## 1. Thiết kế ngắn
- Luồng chính (sequence dạng text hoặc mermaid)
- Module/layer bị ảnh hưởng: contracts / api / web / db / worker
- Lý do chọn cách này; 1 phương án thay thế đã loại và vì sao

## 2. Contract trước (contract-first)
- Endpoint: METHOD /path — request schema — response schema — mã lỗi (400/401/403/404/409/422)
- Schema đặt ở packages/contracts (Zod). Không trả field nhạy cảm (secret, token, password hash).
- Tenant: org_id/project_id lấy từ session, không có trong request body.

## 3. Thay đổi dữ liệu
- Migration: tên, up, down. Có ảnh hưởng dữ liệu cũ không? Có cần backfill không?
- Index cần thiết cho truy vấn tenant-scoped.

## 4. Danh sách file
| File | Tạo/Sửa | Mục đích |
Không sửa file ngoài danh sách này nếu chưa hỏi lại.

## 5. Ma trận test (truy vết AC → test)
| AC | Test name | Loại (unit/integration/e2e) | Dương/Âm |
Bắt buộc có test âm cho: chưa đăng nhập (401), thiếu role (403), cross-org (403/404),
input không hợp lệ (400/422), và (nếu có) secret không lộ ra response/log.

## 6. Dependency mới
| Package | Version (pin) | License | Lý do | Đã kiểm tra tài liệu chính thức? |
Không chắc version tồn tại → ghi UNVERIFIED, không đoán.

## 7. Thứ tự commit
C1: test (FAIL) → C2: contract → C3: migration → C4: implementation → C5: docs ...
Mỗi commit có [{{TASK_ID}}].

## 8. Rủi ro
| Rủi ro | Mức | Giảm thiểu |
(Tham chiếu threat model: injection, lộ credential, tenant leak, CI bypass, giả mạo approval,
audit tampering, webhook replay, prompt injection.)

## 9. Ước lượng độ lớn
S / M / L và lý do. Nếu L → đề xuất tách task.

STATUS: PLAN_READY_FOR_REVIEW
Dừng ở đây. Không code cho tới khi người trả lời "PLAN APPROVED".
```

## Checklist duyệt plan (người vận hành)

- [ ] Không có field `org_id` trong request body
- [ ] Mỗi AC có ít nhất 1 test; có đủ test âm 401/403/cross-org
- [ ] Migration có `down`
- [ ] Không có dependency ngoài ADR, hoặc đã ghi lý do + license
- [ ] Danh sách file không lan sang module ngoài phạm vi
