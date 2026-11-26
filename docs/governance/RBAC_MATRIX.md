# RBAC Matrix — Release 0.1

> **Trạng thái:** `APPROVED_BY_SESSION_USER` (26/11/2026, DECISION_LOG D-2026-11-26-03) — **chờ Owner `residoken-wq` xác nhận**.
> Nguồn sự thật trong code: `packages/contracts/src/rbac.ts`. Test `rbac.test.ts` **fail** nếu bảng dưới đây lệch với code.

## Nguyên tắc
- **Mặc định từ chối.** Route không khai báo permission → 403. Role không có trong danh sách → không có quyền nào.
- **Phạm vi theo org lấy từ session**, không bao giờ từ body/query. Mọi truy vấn dữ liệu nghiệp vụ lọc theo `org_id` của session.
- Đăng nhập (allowlist, ADR-005) **không** cấp role. Role được gán bằng CLI quản trị có ghi audit (`admin.role_granted` / `admin.role_revoked`); role editor UI là P2-04 (sau 0.1).
- Người có role ở nhiều org phải chọn org đang làm việc (`POST /auth/active-org`); hệ thống kiểm tra lại binding mỗi request.
- Mỗi lần từ chối vì thiếu quyền ghi audit `rbac.denied`.

## Ma trận

| Permission | org_admin | maintainer | viewer | Ghi chú |
|---|---|---|---|---|
| `dashboard:read` | ✅ | ✅ | ✅ | P2-02 |
| `org:read` | ✅ | ✅ | ✅ | Thông tin org đang làm việc |
| `project:read` | ✅ | ✅ | ✅ | |
| `project:write` | ✅ | ✅ | ❌ | P2-10 |
| `agent:read` | ✅ | ✅ | ✅ | |
| `agent:write` | ✅ | ✅ | ❌ | P2-05 |
| `provider_account:read` | ✅ | ✅ | ✅ | Chỉ thấy `secret_ref`, không bao giờ thấy secret (P1-07) |
| `provider_account:write` | ✅ | ✅ | ❌ | P2-07 |
| `worker:read` | ✅ | ✅ | ✅ | |
| `worker:write` | ✅ | ✅ | ❌ | P2-08; chỉ worker loại mock ở 0.1 |
| `task:read` | ✅ | ✅ | ✅ | |
| `task:write` | ✅ | ✅ | ❌ | P3-02/P3-04 |
| `dispatch:execute` | ✅ | ✅ | ❌ | P4 — chỉ mock worker |
| `run:read` | ✅ | ✅ | ✅ | Log đã redact |
| `approval:read` | ✅ | ✅ | ✅ | Approval Center chỉ đọc (O-07); **không có permission ghi approval** |
| `audit:read` | ✅ | ❌ | ❌ | Audit log của org |

## Ngoài phạm vi 0.1 (cố ý không có permission)
- Ghi quyết định approval (O-07 — nguồn quyết định là comment `/approve-*` đã xác minh).
- Quản lý role/allowlist qua UI (chỉ CLI vận hành).
- Tạo/xóa org qua UI (CLI vận hành; CRUD org là P2-03).
