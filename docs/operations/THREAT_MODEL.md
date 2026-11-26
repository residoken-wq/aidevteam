# P0-03 — Threat Model (Release 0.1)

> Ngày: 26/11/2026 · Phạm vi: Control Center Release 0.1 (CLAUDE.md §5.2). Trạng thái biện pháp: `ENFORCEMENT_VERIFIED` chỉ khi có test tự động; `IMPLEMENTATION_PENDING` khi chưa có code; `OPS` khi phụ thuộc cấu hình vận hành.

## 1. Tài sản và ranh giới tin cậy

```text
Internet ─HTTPS─▶ NPM 192.168.250.10 ─HTTP LAN─▶ web 192.168.250.30:3301 ─compose net─▶ api ─▶ PostgreSQL
                                                                                  │
GitHub (OAuth, ghcr.io) ◀──────────────────────────────────────────────────────────┘
Người vận hành ─SSH─▶ VPS (deploy.sh, admin CLI)        CI (GitHub Actions) ─▶ ghcr.io
```

| Tài sản | Vì sao quan trọng |
|---|---|
| Session, OAuth client secret | Chiếm quyền đăng nhập |
| Role bindings, allowlist | Leo thang quyền |
| Audit log, release approvals | Bằng chứng kiểm soát; giả mạo = mất khả năng truy vết |
| `secret_ref` (sau này: secret của worker) | Lộ credential sản phẩm khác |
| Image + digest, `deploy.sh` | Đưa mã chưa duyệt lên production |
| Dữ liệu task/ticket/log agent | Dữ liệu không tin cậy, nguồn prompt injection |

## 2. Mối đe dọa và biện pháp

| ID | Mối đe dọa | Biện pháp hiện có | Trạng thái | Còn lại |
|---|---|---|---|---|
| T-01 | **Prompt injection** từ nội dung task/issue/log/output agent | 0.1 chỉ có mock worker, không gọi AI provider; bộ prompt AGY coi dữ liệu là không tin cậy (`docs/agy-prompts/00_SYSTEM_CONTEXT.md`) | Không áp dụng runtime ở 0.1 | Khi có worker thật: tách chỉ dẫn/dữ liệu, giới hạn tool theo role (§9) |
| T-02 | **Lộ credential qua biến môi trường worker** (router v0.1 §6.2-1 `os.environ.copy()`) | `secret_ref` bắt buộc tiền tố `AIDEV_SECRET_` → allowlist được (SECRETS.md) | `IMPLEMENTATION_PENDING` (worker thật sau 0.1) | Test allowlist env khi làm worker-runtime |
| T-03 | Lộ secret/PII qua log, response, audit | Redactor + `RedactingLogger`; lỗi 500 trả chung chung; metadata audit được che | `ENFORCEMENT_VERIFIED` (`redaction.test.ts`, `logger.test.ts`) | Heuristic, không bắt hết |
| T-04 | Lưu secret thật trong DB | `secret_ref` định dạng chặt, từ chối chuỗi giống secret | `ENFORCEMENT_VERIFIED` ở mức schema | Áp dụng khi có P2-07/P2-08 |
| T-05 | **Tenant leak** (IDOR, cross-org) | Org lấy từ session; truy vấn lọc `org_id`; org khác → 404; FK cùng org cho role binding | `ENFORCEMENT_VERIFIED` (`rbac.test.ts`, `constraints.test.ts`) | Mọi route CRUD mới phải theo mẫu |
| T-06 | Leo thang quyền / route quên phân quyền | Guard toàn cục mặc định từ chối; role chỉ gán bằng CLI có audit | `ENFORCEMENT_VERIFIED` | Ai có SSH VPS có thể gán role (kiểm soát vận hành) |
| T-07 | Login CSRF / chiếm session | `state` gắn cookie + DB dùng 1 lần; PKCE S256; cookie `__Host-` HttpOnly Secure Lax; session hash; logout POST + Origin | `ENFORCEMENT_VERIFIED` (`auth.test.ts`) | — |
| T-08 | CSRF trên API ghi | Guard yêu cầu `Origin` khớp cho mọi method ghi | `ENFORCEMENT_VERIFIED` | — |
| T-09 | Flood đăng nhập | 5 lần / 15 phút / IP | `ENFORCEMENT_VERIFIED`; phụ thuộc NPM đặt `X-Forwarded-For` | `OPS`: kiểm tra trên VPS |
| T-10 | Giả `X-Forwarded-For` / vào thẳng `:3301` bỏ qua NPM | `trust proxy` chỉ subnet nội bộ; rule `DOCKER-USER` chỉ cho NPM | Code: verified; firewall: `OPS` (chưa chạy) | Chạy rule trên VPS |
| T-11 | **CI bypass** (merge không qua check, sửa workflow) | Required check `ci` đã định nghĩa; action pin SHA; workflow không dùng secret ngoài `GITHUB_TOKEN` | `DEFINED – NOT ENFORCED (plan: free)` | Branch protection sau khi nâng Pro (O-02) |
| T-12 | **Giả mạo approval** (R-11: Owner chưa bật 2FA) | 0.1: approval thủ công trên PR manifest, `deploy.sh` chỉ nhận digest + link comment; bảng `release_approvals` không sửa/xóa được; Approval Center chỉ đọc (O-07) | DB: verified; quy trình: `OPS` | Bật 2FA; notification cho mọi `/approve-*` trước khi có approval service (O-08) |
| T-13 | Deploy image chưa duyệt | Chỉ nhận digest; không auto-pull; người vận hành đối chiếu digest | `ENFORCEMENT_VERIFIED` (`test_deploy.sh`) | Đối chiếu là bước thủ công |
| T-14 | **Audit tampering** | Trigger chặn UPDATE/DELETE/TRUNCATE; không có route sửa | `ENFORCEMENT_VERIFIED` (`constraints.test.ts`) | Chủ sở hữu bảng vẫn `DROP TRIGGER` được → tách role DB (`CHƯA CẤU HÌNH`); tamper-evidence nâng cao sau 0.1 |
| T-15 | **Webhook replay / giả mạo** | 0.1 **không nhận webhook** | Không áp dụng | Khi có approval service (P6-05): HMAC, chống replay, dedupe (§9) |
| T-16 | Supply chain (dependency, image) | Pin phiên bản + lockfile; base image theo digest; action theo SHA | Một phần | SCA + secret scan trong CI (phần còn lại của P1-09) |
| T-17 | Lộ client secret OAuth | Chỉ trong `/etc/aidevteam/app.env` (600); không vào repo/chat | `OPS` | — |

## 3. Ngoài phạm vi 0.1
Worker thật/AGY, approval service xác minh comment, webhook, CSKH, multi-region.

## Owner cần kiểm tra
- [ ] T-10, T-12, T-14, T-17: các biện pháp vận hành chưa làm.
- [ ] T-11: nâng GitHub Pro + bật branch protection trước 04/12.
- [ ] T-16: có cần SCA/secret scan trước 05/12 không (đề xuất: có).
