# P1-04 + P1-08 — DB schema, migration có rollback, audit append-only

```text
# TASK CARD: P1-04/P1-08 — Schema nền + migration up/down + audit log append-only
Branch: ai/P1-04-db-schema-audit
Nhãn: release-0.1, phase:1
Phụ thuộc: P1-01
ADR cần ACCEPTED: ADR-004 (ORM: Prisma hoặc Drizzle — tiêu chí: migration có rollback,
kiểm soát SQL, tenant scoping)

## Phạm vi (làm)
- PostgreSQL. Bảng nền tối thiểu (tên cuối cùng theo ADR/Master Plan):
  orgs, users (github_user_id BIGINT UNIQUE, KHÔNG lưu email nếu không cần),
  user_allowlist, roles, role_bindings, sessions, audit_events,
  release_approvals (có cột environment ∈ {uat, production} ngay từ migration đầu — O-05;
  bảng chỉ để hiển thị, không có API ghi ở Release 0.1).
- Mọi bảng nghiệp vụ có org_id NOT NULL + index.
- audit_events: id, org_id, actor_user_id, action, target_type, target_id, request_id,
  occurred_at, metadata JSONB (đã redact). Append-only:
  * Không có route/service update/delete.
  * Ở DB: chặn UPDATE/DELETE (trigger hoặc REVOKE quyền cho role ứng dụng) — chọn cách,
    ghi lý do; nếu ORM không hỗ trợ, dùng SQL migration thuần.
- Migration có up + down. Script chạy migrate up/down cho môi trường test.
- Seed dữ liệu giả: 2 org ("Org Test A", "Org Test B"), user github_user_id 900000001..

## Ngoài phạm vi
Hash chain/tamper-evidence nâng cao. Entity CRUD của Phase 2 (task sau thêm migration riêng).

## Acceptance criteria
AC-1 migrate up → down → up trên DB rỗng thành công (test tự động).
AC-2 UPDATE hoặc DELETE audit_events bằng role ứng dụng bị DB từ chối (integration test).
AC-3 release_approvals có cột environment với ràng buộc giá trị uat/production.
AC-4 Seed chỉ chứa dữ liệu giả (@example.com nếu có email).
AC-5 Connection string chỉ đọc từ biến môi trường; không hard-code; .env.example giá trị giả.

## Rủi ro
Audit tampering; migration down làm mất dữ liệu (ghi rõ cảnh báo trong file migration).

## Điểm dừng hỏi người
- Cần DB test: dùng container cục bộ (đề xuất lệnh, người chạy). Không kết nối DB staging/production.
```
