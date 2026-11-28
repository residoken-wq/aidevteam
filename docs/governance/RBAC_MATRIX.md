# RBAC Matrix — Release 0.1

> **Trạng thái:** `OWNER APPROVED` — `residoken-wq` ký 26/11/2026 (DECISION_LOG D-2026-11-26-07, residoken-wq/aidevteam#9).
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
| `provider_account:license` | ✅ | ❌ | ❌ | P2-09 (REQUIRES_OWNER_APPROVAL) |
| `worker:read` | ✅ | ✅ | ✅ | |
| `worker:write` | ✅ | ✅ | ❌ | P2-08; chỉ worker loại mock ở 0.1 |
| `task:read` | ✅ | ✅ | ✅ | |
| `task:write` | ✅ | ✅ | ❌ | P3-02/P3-04 |
| `dispatch:execute` | ✅ | ✅ | ❌ | P4 — chỉ mock worker |
| `run:read` | ✅ | ✅ | ✅ | Log đã redact |
| `approval:read` | ✅ | ✅ | ✅ | Approval Center chỉ đọc (O-07); **không có permission ghi approval** |
| `audit:read` | ✅ | ❌ | ❌ | Audit log của org |
| `member:read` | ✅ | ❌ | ❌ | P2-04 (REQUIRES_OWNER_APPROVAL) |
| `member:write` | ✅ | ❌ | ❌ | P2-04 (REQUIRES_OWNER_APPROVAL) |

## Quản trị nền tảng (platform admin) — P2-03

> **Trạng thái:** `REQUIRES_OWNER_APPROVAL`. Người dùng phiên đồng ý 26/11/2026 (DECISION_LOG D-2026-11-26-13); **chưa nằm trong bản Owner đã ký** (D-2026-11-26-07 mục 5). Phải có chữ ký Owner trước UAT 03/12.

- Platform admin là **người**, không phải role trong org: lưu ở bảng `platform_admins`, chỉ cấp/gỡ bằng CLI vận hành có audit (`admin.platform_admin_granted` / `admin.platform_admin_revoked`). Không có API/UI nào cấp quyền này.
- Platform admin **không** được truy cập dữ liệu trong org (project, worker, audit…). Muốn xem cần có role trong org đó.
- Org đã lưu trữ: mọi request trong org bị từ chối; session không bị thu hồi, người dùng chọn org khác được. Dữ liệu giữ nguyên; khôi phục được.

| Platform permission | platform admin | Ghi chú |
|---|---|---|
| `platform:org:read` | ✅ | Liệt kê mọi org (kể cả đã lưu trữ): slug, tên, thời điểm. Không có thành viên hay dữ liệu bên trong |
| `platform:org:write` | ✅ | Tạo org, đổi tên, lưu trữ, khôi phục. Slug không đổi được |

## Ngoài phạm vi 0.1 (cố ý không có permission)
- Ghi quyết định approval (O-07 — nguồn quyết định là comment `/approve-*` đã xác minh).
- Quản lý role/allowlist qua UI (chỉ CLI vận hành).
- Xóa hẳn org (chỉ lưu trữ/khôi phục). Gán role trong org vẫn bằng CLI (P2-04).
