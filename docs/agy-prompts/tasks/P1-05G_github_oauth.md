# P1-05G — Đăng nhập GitHub OAuth (ADR-005 ACCEPTED)

```text
# TASK CARD: P1-05G — Login bằng GitHub OAuth App, allowlist theo GitHub user ID số
Branch: ai/P1-05G-github-oauth
Nhãn: release-0.1, phase:1
Phụ thuộc: P1-01, P1-04
ADR: ADR-005 ACCEPTED. P1-05 (Entra ID) = REMOVED (O-12) — không viết bất kỳ code Entra/Azure AD nào.

## Bối cảnh
OAuth App do OWNER đăng ký trên GitHub. Client ID/secret nằm trong secret manager của server.
Bạn KHÔNG có và KHÔNG cần giá trị thật. Dev/test dùng mock OAuth server hoặc stub HTTP.

## Phạm vi (làm)
- Luồng authorization code: /auth/github/login → GitHub → /auth/github/callback.
- Tham số `state` ngẫu nhiên (CSPRNG), gắn với session trước đăng nhập, dùng 1 lần, có hạn.
- PKCE: CHỈ bật nếu tài liệu GitHub chính thức xác nhận OAuth App hỗ trợ. Trước khi code,
  trích dẫn link tài liệu; không chắc → ghi UNVERIFIED, không bật, báo người.
- Scope tối thiểu, chỉ đọc định danh. KHÔNG xin `repo` hay bất kỳ scope ghi nào.
  Scope cụ thể: đối chiếu tài liệu GitHub OAuth tại thời điểm làm, ghi link.
- Lấy GitHub user ID SỐ (không dùng login/username làm định danh).
- Kiểm tra user_allowlist theo github_user_id. Không nằm trong allowlist → từ chối + ghi audit
  (action: auth.login_denied).
- Không lưu access token GitHub lâu dài: dùng xong để lấy identity thì bỏ.
- Session phía server (bảng sessions), cookie: HttpOnly, Secure, SameSite (Lax hoặc Strict —
  nêu lý do), có thời hạn; regenerate session id sau đăng nhập.
- Logout: hủy session phía server + xóa cookie.
- Đăng nhập thành công KHÔNG tự cấp role (RBAC tách rời — P1-06).
- Audit: auth.login_succeeded, auth.login_denied, auth.logout, auth.state_mismatch.

## Ngoài phạm vi
Quản lý allowlist qua UI (seed/CLI admin là đủ, hỏi người). Đăng nhập bằng cách khác.

## Acceptance criteria (bắt buộc theo CLAUDE.md §5.3)
AC-1 Callback có state sai/thiếu/đã dùng/hết hạn → bị từ chối (chuyển về /login?error=state), không tạo session, có audit.
AC-2 User GitHub hợp lệ nhưng ngoài allowlist → bị từ chối, có audit login_denied.
AC-3 Session hết hạn → request bảo vệ trả 401.
AC-4 Logout → session bị xóa phía server; dùng lại cookie cũ → 401.
AC-5 User trong allowlist đăng nhập thành công nhưng chưa có role → truy cập tài nguyên → 403.
AC-6 Cookie có HttpOnly, Secure, SameSite (test kiểm tra header Set-Cookie).
AC-7 Access token GitHub không xuất hiện trong DB, log, response (test grep/assert).
AC-8 Scope yêu cầu trong URL authorize không chứa `repo` hay scope ghi.

## Rủi ro
CSRF login, open redirect qua tham số redirect (chỉ cho phép đường dẫn nội bộ cố định),
lộ client secret, session fixation.

## Điểm dừng hỏi người
- Callback URL staging/production (Owner cung cấp; không đoán domain).
- Thời hạn session (đề xuất phương án, người chọn).
```
