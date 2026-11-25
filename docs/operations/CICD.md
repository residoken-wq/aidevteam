# CI/CD — GitHub build image, VPS pull theo digest

> **Phiên bản:** 0.1-draft · **Ngày:** 25/11/2026 · **Trạng thái:** `IMPLEMENTATION_PENDING` (chưa chạy trên GitHub và VPS thật)
> Liên quan: CLAUDE.md §2 (quy tắc 1, 3, 4), §5.5, O-01, O-02. Task: P1-09 (một phần), P1-01 (Dockerfile).

## 1. Mô hình

```text
PR ──▶ [ci] lint/typecheck/test + test script deploy        (không secret)
   └─▶ [build-image] build Docker, KHÔNG push                 (bắt lỗi Dockerfile)

merge vào main ──▶ [build-image] build + push ghcr.io, tag sha-<commit>, provenance + SBOM
                    └─ Job summary in ra image@sha256:<digest>  → ghi vào RELEASE_MANIFEST

Owner duyệt digest (/approve-uat, /approve-production trên PR manifest)
   ──▶ Người vận hành SSH vào VPS, chạy deploy/deploy.sh với đúng digest + link comment duyệt
        └─ pull theo digest → compose up → health check → lỗi thì tự rollback

Người dùng ──HTTPS──▶ NPM server (TLS, domain) ──HTTP, LAN──▶ VPS 192.168.250.30:3301 (container web)
                                                                └─ mạng nội bộ compose ──▶ api:3001
```

**GitHub không deploy và không có quyền vào VPS.** Không có SSH key hay thông tin VPS trong GitHub Secrets. VPS chỉ cần quyền **đọc** image từ ghcr.io.

Không dùng cơ chế tự động pull image mới (kiểu Watchtower): như vậy là tự deploy production khi chưa có approval, vi phạm CLAUDE.md §2 quy tắc 1.

## 2. Thành phần

| File | Vai trò |
|---|---|
| `.github/workflows/ci.yml` | Job `ci` (tên trùng required check ở O-02). Kiểm tra không commit file `.env`/key; chạy test deploy script; lint/typecheck/test khi đã có `package.json` + `pnpm-lock.yaml` + `.nvmrc` (sau P1-01) |
| `.github/workflows/build-image.yml` | Tìm `apps/*/Dockerfile`; chưa có thì bỏ qua. PR: build không push. `main`: build + push `ghcr.io/<owner>/aidevteam-<app>` bằng `GITHUB_TOKEN` |
| `deploy/compose.yaml` | Stack chạy trên VPS: `api`, `web` (theo stack đề xuất). Image chỉ nhận dạng digest. Container read-only, drop mọi capability, `no-new-privileges`. `web` publish ra `WEB_PUBLISH_ADDR:WEB_PUBLISH_PORT`; `api` chỉ bind `127.0.0.1` |
| `deploy/host.env.example` | Cấu hình mạng của VPS (không có secret): `192.168.250.30:3301` |
| `deploy/deploy.sh` | Script người vận hành chạy trên VPS: kiểm tra input, pull theo digest, up, health check, rollback, ghi log |
| `tests/deploy/test_deploy.sh` | 17 test cho validate input và dry-run (chạy trong `ci`) |
| `docs/operations/templates/Dockerfile.node-pnpm.example` | Mẫu Dockerfile, chỉ copy vào `apps/<app>/` ở P1-01 |

Action bên thứ ba được pin theo commit SHA, lấy bằng `git ls-remote` ngày 25/11/2026 tại tag major tương ứng (ghi trong comment).

## 3. Thiết lập một lần (Owner/người vận hành làm — ngoài repo)

Các bước dưới đây thao tác trên GitHub và VPS, Claude/AGY **không** làm.

### 3.1 GitHub

1. Settings → Actions → General: cho phép Actions chạy; "Workflow permissions" để mặc định read (workflow tự xin `packages: write` cho job build).
2. Sau lần push đầu lên `main`, package `aidevteam-api`/`aidevteam-web` xuất hiện ở tab Packages của tài khoản, **mặc định private**. Giữ private.
3. Branch protection cho `main` (required check `ci`): làm sau khi nâng GitHub Pro (O-02). Trước đó trạng thái `DEFINED – NOT ENFORCED (plan: free)`.

### 3.2 Tài khoản máy để VPS pull image

1. Tạo tài khoản GitHub riêng cho máy chủ (ví dụ `pace-deploy-bot`), bật 2FA.
2. Ở trang package trên GitHub, cấp cho tài khoản này quyền **Read** với từng package.
3. Đăng nhập tài khoản máy, tạo token chỉ có scope `read:packages`, có hạn dùng.
   GitHub Container Registry hiện yêu cầu personal access token (classic) để đăng nhập từ ngoài Actions — **chưa xác minh** fine-grained token đã được hỗ trợ cho ghcr.io; kiểm tra tại https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
4. **Không** dùng token của `residoken-wq` (quy tắc cứng 4).

### 3.3 VPS

Người vận hành tự chạy (Claude không nhận và không xử lý token):

```bash
sudo mkdir -p /opt/aidevteam /etc/aidevteam
```

```bash
sudo cp deploy/compose.yaml deploy/deploy.sh /opt/aidevteam/
```

```bash
sudo cp deploy/host.env.example /opt/aidevteam/host.env
```

Đăng nhập registry, nhập token qua stdin để token không nằm trong lịch sử shell:

```bash
docker login ghcr.io -u pace-deploy-bot --password-stdin
```

Tạo `/etc/aidevteam/app.env` chứa cấu hình và secret của ứng dụng (DB URL, OAuth client secret…), quyền `600`, chủ sở hữu root. File này không bao giờ nằm trong repo.

### 3.4 Mạng: NPM server riêng → VPS

| Hạng mục | Giá trị |
|---|---|
| VPS (Docker host), IP LAN | `192.168.250.30` |
| Cổng publish cho NPM | `3301` → container `web:3000` |
| API | Không mở ra LAN. Chỉ `127.0.0.1:3001` trên VPS (health check); `web` gọi `http://api:3001` qua mạng compose |
| TLS, domain | Kết thúc tại NPM server (Owner quản lý) |
| IP của NPM server | `192.168.250.10` (Owner cung cấp 25/11/2026) |

Cấu hình Proxy Host trên NPM (Owner làm): Scheme `http`, Forward Hostname/IP `192.168.250.30`, Forward Port `3301`; bật SSL (certificate cho domain) và Force SSL.

**Firewall trên VPS — lưu ý quan trọng:** cổng do Docker publish **không đi qua** chuỗi INPUT của ufw/iptables thông thường, nên rule `ufw deny` không chặn được `3301`. Muốn chỉ cho NPM server (`192.168.250.10`) truy cập, phải đặt rule ở chuỗi `DOCKER-USER`. Tài liệu chính thức: https://docs.docker.com/engine/network/packet-filtering-firewalls/ . Người vận hành tự chạy trên VPS và tự cấu hình lưu rule qua reboot:

```bash
sudo iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport 3301 --ctdir ORIGINAL ! -s 192.168.250.10 -j DROP
```

Cú pháp trên theo hướng dẫn của Docker tại thời điểm viết; đối chiếu lại tài liệu với phiên bản Docker Engine trên VPS trước khi chạy (Docker Engine mới có thể dùng backend nftables) — **chưa kiểm thử trên VPS**.

Kiểm tra sau khi đặt rule:

- Từ NPM server (`192.168.250.10`): `curl -I http://192.168.250.30:3301/` → phải có phản hồi HTTP.
- Từ một máy khác trong LAN: cùng lệnh → phải bị timeout.
- Từ VPS: `curl -fsS http://127.0.0.1:3001/health/ready` vẫn chạy (loopback không bị ảnh hưởng).

**Ảnh hưởng tới ứng dụng (ghi chú cho P1-05G, P1-06):**

- Đoạn NPM → VPS là HTTP thuần trong LAN. Ứng dụng phải đọc `X-Forwarded-Proto`/`X-Forwarded-For` để biết request gốc là HTTPS (cookie `Secure`, redirect OAuth, audit IP).
- Chỉ tin header `X-Forwarded-*` khi request đến từ NPM server `192.168.250.10`, không tin mọi nguồn — nếu không, người trong LAN có thể giả IP/giao thức. Đề xuất biến cấu hình `TRUSTED_PROXY_IPS=192.168.250.10` trong `/etc/aidevteam/app.env` (tên biến chốt ở P1-05G). Lưu ý: request đi qua Docker port mapping có thể mang IP nguồn là IP thật của NPM hoặc IP gateway Docker tùy cấu hình (`userland-proxy`) — **phải kiểm tra trên VPS** IP nguồn mà container nhìn thấy trước khi chốt allowlist.
- Callback URL của GitHub OAuth App dùng domain công khai trên NPM, không dùng `192.168.250.30`.

## 4. Quy trình deploy (thủ công, có kiểm chứng — §5.5)

1. Mở run `build-image` của commit cần release, lấy `image@sha256:...` ở Job summary, ghi vào `docs/releases/<ver>/RELEASE_MANIFEST.md`.
2. Owner comment `/approve-production <digest>` trên PR manifest.
3. Người vận hành **đối chiếu** digest trong comment với digest sắp chạy (script không tự xác minh comment — approval service là P6-05/P6-08, post-0.1).
4. Trên VPS, chạy thử rồi chạy thật:

```bash
sudo /opt/aidevteam/deploy.sh --dry-run \
  --image api=ghcr.io/<owner>/aidevteam-api@sha256:<digest-api> \
  --image web=ghcr.io/<owner>/aidevteam-web@sha256:<digest-web> \
  --approval-ref https://github.com/<owner>/<repo>/pull/<n>#issuecomment-<id> \
  --health-url http://127.0.0.1:3001/health/ready \
  --health-url http://192.168.250.30:3301/
```

5. Bỏ `--dry-run` để deploy. Health check lỗi → script tự quay về bản trước và thoát mã 1.
6. Rollback chủ động:

```bash
sudo /opt/aidevteam/deploy.sh --rollback --health-url http://127.0.0.1:3001/health/ready
```

7. Log: `/opt/aidevteam/deploy.log` (thời gian UTC, operator, link approval, digest, kết quả). Ghi kết quả vào `APPROVAL_RECORD.md` và post-release report.

`deploy.sh` từ chối: image dùng tag thay vì digest, registry khác `ghcr.io`, repo image không khớp tên service, thiếu link approval hoặc link không phải comment trên PR, health URL lạ, hai lần deploy chạy cùng lúc.

## 5. Trạng thái và việc còn mở

| Hạng mục | Trạng thái |
|---|---|
| Workflow `ci`, `build-image` | `IMPLEMENTATION_PENDING` — chưa có run trên GitHub |
| Build image thật | Chưa có `apps/*/Dockerfile` (chờ P1-01, ADR-001/002 ACCEPTED) |
| Test `deploy.sh` (dry-run, validate) | 17/17 pass cục bộ 25/11/2026 (bash 5.2). **Chưa** chạy với Docker daemon thật |
| `docker compose config` | Hợp lệ cục bộ (Compose v5.7.1) với dữ liệu giả |
| Tài khoản máy + token đọc package | CHƯA CẤU HÌNH (Owner) |
| `/etc/aidevteam/app.env` trên VPS | CHƯA CẤU HÌNH (Owner) |
| Bind `web` ra `192.168.250.30:3301` | `docker compose config` cho kết quả đúng với dữ liệu giả; chưa chạy trên VPS |
| Firewall `DOCKER-USER` chỉ cho NPM server `192.168.250.10` | Lệnh đã soạn; CHƯA CHẠY trên VPS |
| Proxy Host trên NPM | Owner cấu hình; chưa xác minh |
| Giờ chạy release train (`execution_time_local`) | `null` → không có job deploy tự động |
| Branch protection `main` | DEFINED – NOT ENFORCED (plan: free) |
| Ký image (cosign) và kiểm tra chữ ký trên VPS | Chưa làm — đề xuất post-0.1 |

## 6. Rủi ro

| Rủi ro | Biện pháp |
|---|---|
| Deploy image chưa được duyệt | Chỉ nhận digest; bắt buộc link approval; người vận hành đối chiếu digest; không auto-pull |
| Lộ token pull trên VPS | Tài khoản máy riêng, chỉ `read:packages`, có hạn; đăng nhập qua stdin |
| Workflow bị sửa để lấy secret | Workflow không dùng secret ngoài `GITHUB_TOKEN`; job build chỉ có `packages: write` ở job build; cần branch protection + review (O-02) |
| Action bên thứ ba bị chiếm quyền | Pin theo commit SHA; cập nhật có review |
| Máy khác trong LAN truy cập thẳng `:3301`, bỏ qua NPM | Rule `DOCKER-USER` chỉ cho `192.168.250.10`; ứng dụng chỉ tin `X-Forwarded-*` từ IP NPM |
| Lưu lượng NPM → VPS không mã hóa | Chấp nhận trong LAN tin cậy; nếu LAN dùng chung với hệ thống khác, cân nhắc TLS nội bộ (post-0.1) |
| Container bị khai thác | read-only FS, drop capability, `no-new-privileges`, user non-root (template), port chỉ localhost |
| Rollback sai do migration DB không tương thích ngược | Script chỉ rollback image, **không** rollback DB. Migration phải tương thích ngược ít nhất 1 phiên bản; rollback DB theo runbook P1-11 |
