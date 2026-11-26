# ADR-003: Queue / dispatch cho Release 0.1 — job table trong PostgreSQL

- **Trạng thái:** `PROPOSED` (26/11/2026) — cần Owner duyệt trước khi làm P4
- **Liên quan:** P4-01, P4-03, P4-07 (rút gọn), CLAUDE.md §7 (định hướng), §6.2 (bài học router v0.1)

## Bối cảnh
Release 0.1 chỉ dispatch tới **mock worker**. Trạng thái approval và release luôn phải nằm trong PostgreSQL theo transaction (§7). Không có yêu cầu throughput cao.

## Đề xuất
- Bảng `agent_runs` làm hàng đợi; worker lấy việc bằng `SELECT … FOR UPDATE SKIP LOCKED` (cú pháp phải đối chiếu tài liệu PostgreSQL khi làm — **chưa xác minh** trong repo này).
- Chuyển trạng thái có điều kiện (`UPDATE … WHERE status = 'RUNNING'`) để tránh race khi hủy (router §6.2-5).
- Giới hạn độ dài hàng đợi theo org → 429 khi vượt (router §6.2-8).
- Khởi động lại → run `RUNNING` thành `INTERRUPTED`.
- Mock worker chạy trong tiến trình api (hoặc tiến trình riêng cùng image) — không spawn shell, không gọi provider.

## Phương án cân nhắc cho sau 0.1
| Phương án | Ưu | Nhược |
|---|---|---|
| Job table PostgreSQL (đề xuất 0.1) | Không thêm hạ tầng; cùng transaction với dữ liệu | Throughput hạn chế; tự viết retry/backoff |
| BullMQ (Redis) | Retry/delay/rate-limit có sẵn | Thêm Redis; trạng thái tách khỏi DB giao dịch |
| Temporal | Workflow bền, retry, timer | Hạ tầng nặng, học lâu |

## Quyết định cần Owner
Chấp nhận job table PostgreSQL cho 0.1; đánh giá lại BullMQ/Temporal khi có worker thật.
