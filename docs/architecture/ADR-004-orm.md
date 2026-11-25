# ADR-004: ORM — Drizzle ORM + migration SQL có up/down

- **Trạng thái:** `ACCEPTED` (25/11/2026)
- **Người quyết định:** người dùng phiên Claude Code ngày 25/11/2026 ("chọn Drizzle"). **Owner `residoken-wq` cần xác nhận trên PR P1-04** (DECISION_LOG D-2026-11-25-05).
- **Liên quan:** P1-04, P1-08, CLAUDE.md §7 (tiêu chí: migration có rollback, kiểm soát SQL, tenant scoping), §8 (migration test cả hai chiều)

## Quyết định
- `packages/db`: Drizzle ORM 0.45.4 + driver `pg` 8.23.1 cho schema có kiểu và truy vấn.
- **DDL nằm ở file SQL viết tay** `migrations/NNNN_name.up.sql` + `.down.sql`, chạy bằng runner riêng (`src/migrate.ts`):
  - mỗi migration chạy trong một transaction cùng dòng ghi `schema_migrations`;
  - advisory lock chống hai tiến trình migrate cùng lúc;
  - checksum: file `up.sql` đã áp dụng mà bị sửa → dừng (fail closed);
  - `down` bắt buộc cờ `--yes-destroy-data` và bị chặn khi `NODE_ENV=production`.
- Test drift (`test/integration/drift.test.ts`) so cột và nullability giữa Drizzle schema và DB sau migrate.
- Ràng buộc an toàn đặt ở DB: CHECK định dạng, FK composite chống gán role khác org, trigger append-only cho `audit_events` và `release_approvals`.

## Phương án đã cân nhắc
- **drizzle-kit migrate**: không có down migration → không đạt yêu cầu rollback được test hai chiều. Không dùng (có thể dùng `drizzle-kit generate` để tham khảo SQL; chưa cài).
- **Prisma**: migration chỉ có chiều lên, DSL riêng, khó viết trigger/CHECK; client lớn. Không chọn.

## Hệ quả
- Đổi schema = viết cặp SQL up/down + cập nhật `schema.ts`; test drift bắt chỗ quên.
- Trigger append-only chặn được role ứng dụng thông thường nhưng **không** chặn chủ sở hữu bảng (có thể `DROP TRIGGER`). Khuyến nghị vận hành: tách role migrate (owner) và role ứng dụng (chỉ INSERT/SELECT trên audit) — **CHƯA CẤU HÌNH**, cần làm khi dựng DB production.
- Rollback production chỉ rollback image; migration phải tương thích ngược ít nhất 1 phiên bản (CICD.md §6).
- Test tích hợp chạy trên PostgreSQL 16 (local 16.15, CI `postgres:16-bookworm`). **Phiên bản DB production chưa ghi nhận** — cần đối chiếu (SQL dùng tính năng có từ PostgreSQL 13).
