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
| `TRUSTED_PROXY_IPS` | `172.30.250.0/24` | **Subnet mạng nội bộ compose** (`INTERNAL_SUBNET` trong `host.env`), không phải IP NPM — xem mục 5 |
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

Thêm vào allowlist chỉ cho phép đăng nhập. Cấp quyền thao tác (RBAC, P1-06 — `docs/governance/RBAC_MATRIX.md`):

```bash
docker compose --project-name aidevteam -f /opt/aidevteam/compose.yaml run --rm api node node_modules/@aidevteam/db/dist/admin-cli.js org create <org-slug> "<Tên tổ chức>"
```

```bash
docker compose --project-name aidevteam -f /opt/aidevteam/compose.yaml run --rm api node node_modules/@aidevteam/db/dist/admin-cli.js role grant <github_user_id> <org-slug> org_admin
```
 Gỡ: `… allowlist-cli.js remove <github_user_id>` (thu hồi luôn session đang mở). Mọi thay đổi ghi audit.

> Đường dẫn `node_modules/@aidevteam/db/dist/…` trong image api: **chưa kiểm chứng trên image thật** — kiểm tra khi deploy staging lần đầu.

## 4. Kiểm tra sau khi cấu hình (staging trước)
1. Mở `https://<domain>/` → chuyển về `/login`.
2. "Đăng nhập bằng GitHub" → trang GitHub hiển thị **không xin quyền truy cập repo**.
3. Tài khoản trong allowlist → về trang chủ, hiện login GitHub. Tài khoản ngoài allowlist → "chưa được cấp quyền".
4. Đăng xuất → về `/login`; F5 trang chủ → lại về `/login`.
5. Đăng nhập lặp lại 6 lần trong 15 phút từ cùng một máy → lần thứ 6 nhận "Quá nhiều lần đăng nhập"; một máy khác vẫn đăng nhập được (chứng tỏ đếm đúng theo IP người dùng, không phải IP của NPM/web).

## 5. Vì sao `TRUSTED_PROXY_IPS` là subnet nội bộ
Đường đi: trình duyệt → NPM (`192.168.250.10`) → `web` (`192.168.250.30:3301`) → `api` (mạng compose).
Đã kiểm chứng cục bộ ngày 26/11/2026: proxy rewrite của Next.js **chuyển nguyên** `X-Forwarded-For` nhận từ NPM sang api nhưng **không thêm** IP của chính nó. Vì vậy api thấy kết nối đến từ container `web` (thuộc `INTERNAL_SUBNET`), còn IP người dùng là phần tử cuối của `X-Forwarded-For` do NPM thêm vào.
- Tin subnet nội bộ → `req.ip` = IP người dùng do NPM ghi; giá trị giả mà client tự chèn phía trước bị bỏ qua.
- **Chưa kiểm chứng:** NPM có đặt `X-Forwarded-For` (dạng `$proxy_add_x_forwarded_for`) hay không — kiểm tra ở bước 5 mục 4. Nếu NPM không đặt, mọi người dùng bị đếm chung một IP (của NPM) → giới hạn 5 lần sẽ áp cho cả hệ thống; khi đó báo lại để điều chỉnh.
- Cổng `3301` chỉ được để NPM truy cập (rule `DOCKER-USER`, CICD.md §3.4); nếu không, máy khác trong LAN có thể tự đặt `X-Forwarded-For` giả.
