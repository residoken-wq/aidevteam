# Cấu hình đăng nhập GitHub (P1-05G) — việc của Owner / người vận hành

> Không dán client secret, token hay connection string vào chat, issue, PR hay repo (CLAUDE.md §5.3).
> Trạng thái: `IMPLEMENTATION_PENDING` — code đã có test; chưa chạy với OAuth App thật.

## 1. Đăng ký OAuth App (Owner `residoken-wq`)
GitHub → Settings → Developer settings → OAuth Apps → New OAuth App:

| Trường | Giá trị |
|---|---|
| Application name | `AI Dev Team Control Center` (staging nên đăng ký app riêng) |
| Homepage URL | `https://<domain-production>` |
| Authorization callback URL | `https://<domain-production>/auth/github/callback` — **phải khớp** `PUBLIC_BASE_URL` + `/auth/github/callback`; không dùng `192.168.250.30` |
| Enable Device Flow | Không bật |

Tạo client secret và đưa **thẳng** vào file secret trên VPS (mục 2). Không cần cấp quyền nào cho app — ứng dụng không xin `scope`.

## 2. Biến môi trường trên VPS — `/etc/aidevteam/app.env` (quyền 600)

| Biến | Ví dụ (giả) | Ghi chú |
|---|---|---|
| `DATABASE_URL` | `postgres://app:…@db-host:5432/aidevteam` | Secret |
| `PUBLIC_BASE_URL` | `https://cc.example.com` | Origin công khai qua NPM, không có path |
| `GITHUB_OAUTH_CLIENT_ID` | `Iv1.xxxxxxxx` | |
| `GITHUB_OAUTH_CLIENT_SECRET` | — | Secret |
| `TRUSTED_PROXY_IPS` | `192.168.250.10` | IP NPM server; xem lưu ý mục 4 |
| `SESSION_TTL_MINUTES` | `480` | Mặc định 480 (8 giờ) — chờ Owner xác nhận |

API thiếu hoặc sai bất kỳ biến bắt buộc nào sẽ **không khởi động** (fail closed); thông báo lỗi chỉ nêu tên biến, không in giá trị.

## 3. Migrate DB và thêm người được phép đăng nhập
Chạy trong container api (đã có `@aidevteam/db` trong bundle) — lệnh minh họa, người vận hành tự chạy:

```bash
docker compose --project-name aidevteam -f /opt/aidevteam/compose.yaml run --rm api node node_modules/@aidevteam/db/dist/cli.js up
```

Lấy **GitHub user ID số** (không phải username) từ API công khai `https://api.github.com/users/<login>` (trường `id`), rồi:

```bash
docker compose --project-name aidevteam -f /opt/aidevteam/compose.yaml run --rm api node node_modules/@aidevteam/db/dist/allowlist-cli.js add <github_user_id> "Owner"
```

Thêm vào allowlist chỉ cho phép đăng nhập; quyền thao tác cấp qua RBAC (P1-06). Gỡ: `… allowlist-cli.js remove <github_user_id>` (thu hồi luôn session đang mở). Mọi thay đổi ghi audit.

> Đường dẫn `node_modules/@aidevteam/db/dist/…` trong image api: **chưa kiểm chứng trên image thật** — kiểm tra khi deploy staging lần đầu.

## 4. Kiểm tra sau khi cấu hình (staging trước)
1. Mở `https://<domain>/` → chuyển về `/login`.
2. "Đăng nhập bằng GitHub" → trang GitHub hiển thị **không xin quyền truy cập repo**.
3. Tài khoản trong allowlist → về trang chủ, hiện login GitHub. Tài khoản ngoài allowlist → "chưa được cấp quyền".
4. Đăng xuất → về `/login`; F5 trang chủ → lại về `/login`.
5. Kiểm tra IP nguồn mà api nhìn thấy (đi qua NPM → web → api): nếu không phải `192.168.250.10`, điều chỉnh `TRUSTED_PROXY_IPS` — **chưa kiểm chứng** (CICD.md §3.4).
