# ADR-005: Đăng nhập bằng GitHub OAuth App

- **Trạng thái:** `ACCEPTED` (Owner duyệt 25/11/2026 — CLAUDE.md §4, §5.3)
- **Triển khai:** P1-05G (thay P1-05 Entra ID — `REMOVED (O-12)`)
- **Phương án đã cân nhắc:** tài khoản nội bộ (không chọn); chỉ chặn mạng (không chấp nhận cho production)

## Quyết định
Đăng nhập bằng **GitHub OAuth App, web application flow**, xác định người dùng bằng **GitHub user ID số**, chỉ cho phép ID có trong bảng `user_allowlist`. Đăng nhập và phân quyền tách rời: đăng nhập thành công không cấp role nào (RBAC — P1-06).

## Dữ kiện đã xác minh (mã nguồn tài liệu chính thức `github/docs`, lấy qua raw.githubusercontent.com ngày 26/11/2026)
> docs.github.com bị chặn ở mạng của môi trường làm việc; nội dung dưới đây đọc từ file nguồn của chính trang tài liệu đó.

| Dữ kiện | Nguồn (file trong `github/docs`) |
|---|---|
| PKCE được hỗ trợ cho OAuth App trên github.com (`pkce_support: fpt: '*'`), `code_challenge_method` **phải là `S256`**, `plain` không hỗ trợ; `code_verifier` gửi khi đổi code | `content/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps.md`, `data/features/pkce_support.yml` |
| Không truyền `scope` → mặc định danh sách rỗng; `(no scope)` = chỉ đọc thông tin công khai (gồm profile) | `authorizing-oauth-apps.md`, `scopes-for-oauth-apps.md` |
| Mã `code` hết hạn sau **10 phút**; `state` không khớp → phải hủy luồng | `authorizing-oauth-apps.md` |
| Đổi code: `POST https://github.com/login/oauth/access_token`, `Accept: application/json` | `authorizing-oauth-apps.md` |
| Lỗi đổi code dạng JSON `{"error":"bad_verification_code",…}` | `maintaining-oauth-apps/troubleshooting-oauth-app-access-token-request-errors.md` |
| `X-GitHub-Api-Version: 2022-11-28` còn được hỗ trợ trên github.com (cùng `2026-03-10`) | `src/rest/lib/config.json` |

**Chưa xác minh:** tài liệu không nói lỗi đổi code trả HTTP 200 hay 4xx → code kiểm tra cả status lẫn trường `error`. Ngày ngừng hỗ trợ API version `2022-11-28`: chưa thấy trong file đã đọc.

## Thiết kế
- `GET /auth/github/login`: tạo `state` và `code_verifier` ngẫu nhiên 32 byte; lưu **SHA-256 của state** + verifier vào `oauth_login_states` (hết hạn 10 phút, dùng 1 lần); đặt cookie `__Host-cc_oauth_state`; chuyển tới GitHub với `code_challenge` S256, `allow_signup=false`, **không có `scope`**.
- `GET /auth/github/callback`: `state` trên URL phải **bằng cookie** (so sánh hằng thời gian) **và** khớp một bản ghi chưa dùng, chưa hết hạn (UPDATE … RETURNING, nguyên tử). Đổi code → lấy `id`, `login` → **bỏ access token** (không lưu, không trả về). Kiểm tra allowlist → tạo session.
- Session phía server: token ngẫu nhiên 32 byte, DB chỉ lưu SHA-256; cookie `__Host-cc_session` `HttpOnly; Secure; SameSite=Lax; Path=/`; hết hạn tuyệt đối `SESSION_TTL_MINUTES` (mặc định 480).
- Đăng nhập lại thu hồi session cũ đang gửi kèm (chống fixation). Đăng xuất `POST /auth/logout` chỉ chấp nhận `Origin` = `PUBLIC_BASE_URL` (CSRF), thu hồi session phía server.
- Lỗi → chuyển về `/login?error=state|denied|failed`; trang login chỉ hiển thị thông báo cố định, không phản chiếu input.
- Audit: `auth.login_succeeded`, `auth.login_denied`, `auth.login_failed`, `auth.state_mismatch`, `auth.logout`, `admin.allowlist_added/removed`. Không ghi token, code, email.
- `SameSite=Lax` (không phải `Strict`): callback là điều hướng cấp cao từ github.com; với `Strict` cookie state sẽ không được gửi kèm.
- Trình duyệt đi qua NPM → `web` (Next.js) → rewrite `/auth/*` sang `api`. `TRUSTED_PROXY_IPS` chỉ chứa IP được tin `X-Forwarded-*`.

## Hệ quả / việc còn mở
- Chưa có rate limit cho `/auth/*` — đề xuất bổ sung trước production (R mới, xem PR).
- Dọn bản ghi `oauth_login_states`/`sessions` hết hạn: chưa có job — dữ liệu nhỏ, đề xuất làm cùng P1-10/P1-11.
- Thời hạn session 8 giờ là **đề xuất**, Owner cần xác nhận.
