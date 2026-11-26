# P0-07 — UX flows (chỉ phạm vi Release 0.1, CLAUDE.md §5.2)

> Ngày: 26/11/2026 · Trạng thái: `PROPOSED`. Giao diện tiếng Việt. Mọi màn hình (trừ đăng nhập) yêu cầu session; nút/ô nhập chỉ hiện khi role có quyền (RBAC_MATRIX), nhưng **quyền luôn được kiểm tra ở api**.

## 1. Danh sách màn hình

| # | Màn hình | Đường dẫn | Quyền | Trạng thái |
|---|---|---|---|---|
| S-01 | Đăng nhập | `/login` | Công khai | **Đã có** (P1-05G) |
| S-02 | Trang chủ / chọn tổ chức | `/` | Đã đăng nhập | **Đã có** (P1-06) |
| S-03 | Dashboard tổng quan | `/dashboard` | `dashboard:read` | P2-02 |
| S-04 | Project: danh sách, tạo/sửa | `/projects` | `project:read` / `project:write` | P2-10 |
| S-05 | Agent | `/agents` | `agent:read` / `agent:write` | P2-05 |
| S-06 | Provider account (chỉ `secret_ref`) | `/provider-accounts` | `provider_account:*` | P2-07 |
| S-07 | Worker (chỉ loại mock) | `/workers` | `worker:*` | P2-08 |
| S-08 | Task: Kanban + chi tiết | `/projects/:slug/tasks` | `task:*` | P3-02/P3-04 |
| S-09 | Dispatch + danh sách run + log | trong S-08, `/runs/:id` | `dispatch:execute`, `run:read` | P4 |
| S-10 | Approval Center (chỉ đọc) | `/approvals` | `approval:read` | P6-06 |
| S-11 | Audit log | `/audit` | `audit:read` | Có API (P1-06), UI chưa có |

## 2. Luồng chính

**F-01 Đăng nhập** — S-01 → GitHub → (ngoài allowlist: S-01 kèm thông báo) → S-02. Quá 5 lần/15 phút: thông báo thử lại sau.

**F-02 Chọn tổ chức** — S-02: không có role → thông báo liên hệ quản trị; 1 org → vào thẳng; nhiều org → chọn.

**F-03 Thiết lập project** (maintainer) — S-04 tạo project → S-05 tạo agent → S-06 tạo provider account (nhập `env:AIDEV_SECRET_…`; dán secret thật → báo lỗi, không hiển thị lại giá trị) → S-07 tạo worker mock (đường dẫn workspace không trùng).

**F-04 Làm việc với task** (maintainer) — S-08 tạo task → kéo thả giữa cột theo STATE_MACHINES §1 (chuyển không hợp lệ → hoàn tác + thông báo) → dispatch tới worker mock → S-09 xem trạng thái/log (log hiển thị dạng text, đã redact).

**F-05 Theo dõi** (viewer trở lên) — S-03 dashboard số liệu thật của org → S-10 xem approval, link sang PR GitHub (không có nút duyệt).

**F-06 Kiểm tra audit** (org_admin) — S-11 danh sách sự kiện của org.

## 3. Nguyên tắc giao diện
- Không hiển thị số liệu giả; org rỗng → trạng thái rỗng.
- Thông báo lỗi cố định, không phản chiếu input.
- Không có nút ghi approval (O-07); không có UI sửa role (P2-04 sau 0.1).
