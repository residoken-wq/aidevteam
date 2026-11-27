# Hướng dẫn Môi trường Phát triển (Dev Environment)

Tài liệu hướng dẫn thiết lập và vận hành môi trường phát triển cục bộ cho dự án **AI Dev Team Control Center** bằng Docker Compose.

---

## 1. Yêu cầu tiên quyết

Trước khi khởi động môi trường dev, máy của bạn cần cài đặt:
- **Docker & Docker Compose** (khuyến nghị Docker Compose v2).
- **Node.js**: phiên bản `>=24.0.0 <25.0.0` (khuyến nghị `24.22.3` theo `.nvmrc`).
- **pnpm**: phiên bản `10.34.9` (theo `packageManager` trong `package.json`).
- *(Tùy chọn)* **PostgreSQL Client** (`psql` phiên bản 16) nếu muốn truy vấn trực tiếp vào DB dev.

---

## 2. Khởi động nhanh với 1 lệnh

### Khởi động mặc định (PostgreSQL Container + Migrate + Seed)
Chỉ cần chạy lệnh sau từ thư mục gốc của repository:

```bash
pnpm dev:up
# hoặc: bash dev/up.sh
```

Lệnh này sẽ tự động thực hiện:
1. Khởi động service `postgres` trong `dev/compose.yaml` (project name `aidevteam-dev`).
2. Chờ PostgreSQL sẵn sàng (`--wait` qua healthcheck `pg_isready -U postgres`).
3. Tự động chạy SQL script trong `dev/initdb/01-init.sql` tạo sẵn 2 database: `aidevteam_dev` và `aidevteam_test`.
4. Áp dụng toàn bộ migration vào database `aidevteam_dev` (`pnpm --filter @aidevteam/db migrate up`).
5. Seed dữ liệu mẫu (fake data) vào `aidevteam_dev` (`pnpm --filter @aidevteam/db seed`).
6. In ra màn hình thông tin cổng và biến môi trường sẵn sàng cho bạn phát triển.

### Khởi động kèm cả API và Web trong container
Nếu bạn muốn chạy cả backend `api` (NestJS) và frontend `web` (Next.js) bên trong Docker container:

```bash
pnpm dev:up --app
# hoặc: bash dev/up.sh --app
```

---

## 3. Cổng và URL dịch vụ

Mọi cổng trong môi trường dev được cấu hình **chỉ bind trên loopback (`127.0.0.1`)**, không mở ra mạng ngoài hay mạng LAN:

| Dịch vụ | Địa chỉ & Cổng | Database / Đường dẫn | Ghi chú |
|---|---|---|---|
| **PostgreSQL (Dev)** | `127.0.0.1:55433` (hoặc `${DEV_PG_PORT}`) | `aidevteam_dev` | Dùng cho API/Web chạy dev |
| **PostgreSQL (Test)** | `127.0.0.1:55433` (hoặc `${DEV_PG_PORT}`) | `aidevteam_test` | Dùng cho integration test |
| **API Backend** | `127.0.0.1:3001` (hoặc `${DEV_API_PORT}`) | `http://127.0.0.1:3001` | NestJS REST API |
| **Web Frontend** | `127.0.0.1:3000` (hoặc `${DEV_WEB_PORT}`) | `http://127.0.0.1:3000` | Next.js Frontend UI |

> [!NOTE]
> Cổng mặc định của PostgreSQL dev là **55433**, khác với cổng 55432 để tránh xung đột với container test hiện có trên máy.

---

## 4. Chạy Integration Test với DB Dev

Database `aidevteam_test` đã được tạo sẵn trong cùng container dev. Để chạy bộ kiểm thử tích hợp (integration tests) trỏ tới DB này:

```bash
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55433/aidevteam_test pnpm test:integration
```

---

## 5. Dừng môi trường

### Dừng thông thường (giữ lại dữ liệu)
```bash
pnpm dev:down
# hoặc: bash dev/down.sh
```
Lệnh này dừng các container dev nhưng giữ nguyên volume `aidevteam-dev-pg`. Dữ liệu và migration không bị mất.

### Xóa toàn bộ dữ liệu (Reset sạch sẽ volume)
Nếu bạn muốn xóa sạch cơ sở dữ liệu và bắt đầu lại từ đầu:
```bash
bash dev/down.sh --volumes --yes
```
> [!WARNING]
> Cờ `--yes` là bắt buộc khi truyền `--volumes` để chống việc vô tình xóa mất dữ liệu dev cục bộ.

---

## 6. Cảnh báo bảo mật quan trọng (DEV ONLY)

> [!CAUTION]
> **Cấu hình trong thư mục `dev/` chỉ dành riêng cho môi trường phát triển cục bộ:**
> 1. **Trust Authentication (`POSTGRES_HOST_AUTH_METHOD=trust`)**: Cơ chế này cho phép kết nối không cần mật khẩu. Điều này **chỉ an toàn vì cổng PostgreSQL được bind độc quyền vào `127.0.0.1`** (loopback). Tuyệt đối không thay đổi port mapping thành `0.0.0.0` hoặc mở ra mạng LAN.
> 2. **File `dev/dev.env` được commit vào Git**: Toàn bộ giá trị trong file này là **giá trị giả** (`dev-fake-not-a-secret`, `Iv1.fake-dev-client-id`). Tuyệt đối không dán API key, token hoặc credentials thật vào file này.
> 3. **Đăng nhập GitHub OAuth**: Vì client ID và client secret là giả, luồng đăng nhập GitHub OAuth thật sẽ không hoạt động cục bộ. Khi phát triển giao diện hoặc test API, sử dụng dữ liệu user đã được seed sẵn và tạo session token giả như mô tả trong [tests/e2e/run-local.sh](file:///tests/e2e/run-local.sh).

---

## 7. So sánh `dev/compose.yaml` và `deploy/compose.yaml`

Bảng dưới đây nêu rõ sự khác biệt thiết kế giữa môi trường Dev và môi trường Production:

| Tiêu chí | Môi trường Dev (`dev/compose.yaml`) | Môi trường Production (`deploy/compose.yaml`) |
|---|---|---|
| **Mục đích** | Phát triển cục bộ, chạy nhanh, test tích hợp | Vận hành thật trên VPS production/staging |
| **Project Name** | `aidevteam-dev` | Mặc định theo thư mục deploy |
| **PostgreSQL** | Chạy container cục bộ, trust auth, cổng `55433` | Không nằm trong compose (dùng PostgreSQL VPS / managed riêng) |
| **Image API & Web** | Build trực tiếp từ source Dockerfile cục bộ | Pull từ GHCR theo digest bất biến (`@sha256:...`) |
| **Image PostgreSQL** | Pin theo digest cố định như CI (`postgres:16-bookworm@sha256:...`) | N/A |
| **Cấu hình Secret** | `dev/dev.env` (cam kết an toàn, toàn bộ là fake) | `/etc/aidevteam/app.env` trên VPS (không commit, quản lý bí mật) |
| **Network & Binding** | Loopback (`127.0.0.1`) cho mọi service | Web bind LAN VPS (`192.168.250.30:3301`) cho NPM reverse proxy; API loopback `127.0.0.1:3001` |
| **Internal Subnet** | Docker default bridge | Cố định `172.30.250.0/24` (để API xác minh proxy hop) |
| **Profiles** | `postgres` mặc định; `app` bật thêm `api` & `web` | Cả `api` và `web` luôn chạy đồng thời |
| **Hardening** | `no-new-privileges`, `cap_drop: [ALL]`, cấm `docker.sock` | Tối đa: `read_only: true`, tmpfs, cap_drop, json-file logging limits |
