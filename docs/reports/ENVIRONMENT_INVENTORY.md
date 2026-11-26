# P0-02 — Environment Inventory

> Ngày: 26/11/2026 · Không ghi bất kỳ giá trị secret nào. Giá trị chưa biết ghi `CHƯA CẤU HÌNH` / `UNVERIFIED`.

## 1. Công cụ phát triển (lấy từ lệnh `--version` trong môi trường làm việc của Claude, 26/11/2026)

| Công cụ | Phiên bản | Nguồn |
|---|---|---|
| Node.js | v24.22.3 (LTS "Krypton") — khớp `.nvmrc` | `node --version`; tarball kiểm SHA-256 với `SHASUMS256.txt` của nodejs.org |
| pnpm | 10.34.9 — khớp `packageManager` | `pnpm --version` |
| TypeScript | 6.0.3 | `package.json` (pin) |
| git | 2.43.0 | `git --version` |
| Docker CLI / Compose | 29.9.3 / v5.7.1 (môi trường Claude **không có Docker daemon**) | `docker --version`, `docker compose version` |
| PostgreSQL (test cục bộ) | 16.15 | `psql --version` |
| Python | 3.13.18 (không dùng trong sản phẩm) | `python3 --version` |

## 2. CI (GitHub Actions)

| Hạng mục | Giá trị |
|---|---|
| Runner | `ubuntu-latest` |
| Workflow | `ci` (lint, typecheck, unit, integration với PostgreSQL), `build-image` (discover + build api/web; push ghcr.io khi merge `main`) |
| PostgreSQL service | `postgres:16-bookworm@sha256:cd0e9518…ef37` (digest lấy 25/11/2026) |
| Base image ứng dụng | `node:24.22.3-bookworm-slim@sha256:873f586f…b34530` |
| Action | Pin theo commit SHA (xem comment trong `.github/workflows/*.yml`) |
| Kết quả gần nhất | Xanh trên PR #3–#7 (xem `TEST_EVIDENCE.md`) |

## 3. GitHub

| Hạng mục | Giá trị | Trạng thái |
|---|---|---|
| Repo | `residoken-wq/aidevteam` (private, tài khoản cá nhân) | Đã xác minh (truy cập qua API) |
| Gói | Free (theo CLAUDE.md §3 O-02) — Owner sẽ nâng Pro trước 05/12 | `UNVERIFIED` (không đọc được thông tin gói) |
| Branch protection `main` | Chưa bật | `DEFINED – NOT ENFORCED (plan: free)` |
| Protected environment có required reviewer | Không có trên gói Pro cho private repo (O-01) | `NOT AVAILABLE ON PLAN` |
| GitHub Actions | Đã bật (CI chạy trên PR #2 trở đi) | Đã xác minh |
| Package ghcr.io | `aidevteam-api`, `aidevteam-web` — push khi merge `main` | Quyền đọc cho tài khoản máy: `CHƯA CẤU HÌNH` |
| OAuth App (ADR-005) | — | `CHƯA CẤU HÌNH` (Owner đăng ký) |
| 2FA tài khoản Owner | Chưa bật | Rủi ro R-11 |

## 4. Hạ tầng production / staging

| Hạng mục | Giá trị | Trạng thái |
|---|---|---|
| VPS chạy Docker | IP LAN `192.168.250.30` | Người dùng cung cấp 25/11/2026 |
| Cổng publish cho NPM | `3301` → container `web:3000` | Người dùng cung cấp |
| Reverse proxy / TLS | Nginx Proxy Manager riêng, IP `192.168.250.10` | Người dùng cung cấp |
| Mạng nội bộ compose | `172.30.250.0/24` (`INTERNAL_SUBNET`) | Đề xuất — kiểm tra không trùng mạng VPS |
| `TRUSTED_PROXY_IPS` | = `INTERNAL_SUBNET` | Xem `AUTH_SETUP.md` §5 |
| Firewall `DOCKER-USER` chỉ cho NPM vào `:3301` | Lệnh đã soạn (CICD.md §3.4) | `CHƯA CHẠY` |
| Domain production | — | `CHƯA CẤU HÌNH` (cần cho OAuth callback) |
| Domain / môi trường staging | — | `CHƯA CẤU HÌNH` |
| PostgreSQL production: phiên bản, vị trí | — | `UNVERIFIED` (SQL dùng tính năng từ PG 13; test trên 16) |
| Tách role DB (migrate/owner vs ứng dụng) | — | `CHƯA CẤU HÌNH` |
| Backup DB: công cụ, tần suất, nơi lưu, RPO/RTO | Owner xác nhận "đã có" | Chi tiết `CHƯA CẤU HÌNH` |
| Tài khoản máy pull ghcr.io (`read:packages`) | — | `CHƯA CẤU HÌNH` |
| `/etc/aidevteam/app.env`, `/opt/aidevteam/host.env` | Mẫu: `.env.example`, `deploy/host.env.example` | `CHƯA CẤU HÌNH` |

## 5. Tham số policy (CLAUDE.md §4)

| Tham số | Giá trị |
|---|---|
| `execution_time_local` | `null` — `CHƯA CẤU HÌNH` |
| `ttl_minutes` | `null` — `CHƯA CẤU HÌNH` (chặn deploy) |
| `notification_channels` | `[]` — `CHƯA CẤU HÌNH` |
| Người duyệt thay | `null` — `CHƯA CẤU HÌNH` (fail closed) |
| `policy_version` đang hiệu lực | v1.0.1 — file `SOURCE_MISSING` |

## Owner cần kiểm tra
- [ ] Cung cấp: domain production + staging, phiên bản/vị trí PostgreSQL production, thông tin backup (không ghi secret).
- [ ] Xác nhận subnet `172.30.250.0/24` không trùng mạng trên VPS.
- [ ] Đăng ký OAuth App, tạo tài khoản máy pull ghcr.io, chạy rule `DOCKER-USER`.
