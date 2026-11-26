# DECISION LOG

> Nguồn sự thật số 1 (CLAUDE.md §1). Cập nhật lần cuối: 26/11/2026.
> Quy ước trạng thái:
> - `OWNER APPROVED` / `OWNER CONFIRMED`: theo CLAUDE.md v1.2 §4 (Owner `residoken-wq` duyệt 25/11/2026).
> - `NGƯỜI DÙNG PHIÊN ĐỒNG Ý`: người dùng phiên Claude Code (tài khoản GitHub `kensuben`) đồng ý; **chưa có xác nhận trực tiếp của `residoken-wq`**.
> - `CHƯA CẤU HÌNH`: giá trị chưa có — hệ thống fail closed.
> Chat không phải nguồn approval release (CLAUDE.md §2 quy tắc 7). Các mục dưới đây là quyết định thiết kế/quy trình, không phải approval UAT/production.

## A. Ảnh chụp quyết định Owner (khởi tạo từ CLAUDE.md §4, 25/11/2026)

| ID | Hạng mục | Giá trị | Trạng thái |
|---|---|---|---|
| D-OWN-01 | Owner / GitHub reviewer / người ký UAT | `residoken-wq` | OWNER APPROVED |
| D-OWN-02 | Control Center production release | **05/12/2026** | OWNER APPROVED |
| D-OWN-03 | Repo hosting | Tài khoản GitHub cá nhân; nâng Pro trước 05/12/2026; chuyển sang tài khoản doanh nghiệp sau 15/01/2027 | OWNER APPROVED |
| D-OWN-04 | Entra ID OIDC | Bỏ khỏi project (O-12) | OWNER APPROVED |
| D-OWN-05 | Cơ chế đăng nhập | GitHub OAuth App (ADR-005) | OWNER APPROVED |
| D-OWN-06 | Code review | Người review mọi code trước khi merge vào `main` | OWNER APPROVED |
| D-OWN-07 | Release train | Hằng ngày, tối đa 1 lô/project | OWNER APPROVED |
| D-OWN-08 | SEV1/SEV2 | Hotfix riêng, Owner duyệt riêng từng lần | OWNER APPROVED |
| D-OWN-09 | Giờ chạy release train (`execution_time_local`) | `null` → không có job release tự động | CHƯA CẤU HÌNH |
| D-OWN-10 | `ttl_minutes` | `null` → chặn deploy | CHƯA CẤU HÌNH |
| D-OWN-11 | `notification_channels` | `[]` | CHƯA CẤU HÌNH |
| D-OWN-12 | Người duyệt thay khi Owner vắng | `null` → fail closed | CHƯA CẤU HÌNH |
| D-OWN-13 | Hosting production, domain, TLS, DB, backup | Đã có; chi tiết ở `docs/reports/ENVIRONMENT_INVENTORY.md` (không ghi secret) | OWNER CONFIRMED (chi tiết domain/DB còn thiếu) |
| D-OWN-14 | Phạm vi Release 0.1 | CLAUDE.md §5.2 | OWNER APPROVED |
| D-OWN-15 | Xác nhận chính thức policy v1.0.2 | Trước 04/12/2026 | OWNER COMMITTED (chưa xác nhận) |
| D-OWN-16 | Kênh duyệt giai đoạn 1 | Comment `/approve-*` trên PR | THỐNG NHẤT (v1.0.2, chờ xác nhận) |
| D-OWN-17 | UAT và production cùng người duyệt | Cho phép ở giai đoạn 1 | THỐNG NHẤT (v1.0.2) |
| D-OWN-18 | 2FA tài khoản Owner | Chưa bật, rủi ro chấp nhận tạm thời (R-11) | THỐNG NHẤT (v1.0.2) |
| D-OWN-19 | Antigravity | `internal_data_approval: APPROVED`, `provider_terms: UNVERIFIED` (O-06) | XEM O-06 |
| D-OWN-20 | Tài khoản Claude | 2–3 tài khoản cho người, API key cho automation (O-10) | THỐNG NHẤT |
| D-OWN-21 | Tech stack | Theo ADR — xem D-2026-11-25-02, D-2026-11-25-05; ADR-003 PROPOSED | XEM DƯỚI |

## B. Quyết định phát sinh trong quá trình thực hiện

| ID | Ngày | Quyết định | Người quyết | Bằng chứng | Trạng thái |
|---|---|---|---|---|---|
| D-2026-11-25-01 | 25/11/2026 | Cho phép bắt đầu code Phase 1 (từ P1-01) **trước khi** Owner ký baseline Phase 0 — ngoại lệ với CLAUDE.md §7 | Người dùng phiên, xác nhận có đồng ý của Owner | Trả lời trong phiên; residoken-wq/aidevteam#3 | NGƯỜI DÙNG PHIÊN ĐỒNG Ý — **chờ `residoken-wq` xác nhận** |
| D-2026-11-25-02 | 25/11/2026 | ADR-001 (Next.js) và ADR-002 (NestJS + Zod, pnpm, Node 24 LTS) → `ACCEPTED` | Người dùng phiên | residoken-wq/aidevteam#3 | NGƯỜI DÙNG PHIÊN ĐỒNG Ý — chờ `residoken-wq` xác nhận |
| D-2026-11-25-03 | 25/11/2026 | PR có CI xanh → Claude hỏi; người dùng đồng ý rõ ràng từng PR → Claude thực hiện thao tác merge. Câu trả lời đồng ý = quyết định review của người dùng (không phải review của Claude) | Người dùng phiên | Trả lời trong phiên | ÁP DỤNG |
| D-2026-11-25-04 | 25/11/2026 | CI/CD: GitHub build image lên ghcr.io; VPS `192.168.250.30` pull theo digest, chạy thủ công sau approval; web publish `:3301` cho NPM `192.168.250.10` | Người dùng phiên | residoken-wq/aidevteam#2 | ĐÃ MERGE |
| D-2026-11-25-05 | 25/11/2026 | ADR-004: Drizzle ORM + migration SQL up/down tự quản lý → `ACCEPTED` | Người dùng phiên | residoken-wq/aidevteam#4 | NGƯỜI DÙNG PHIÊN ĐỒNG Ý — chờ `residoken-wq` xác nhận |
| D-2026-11-26-01 | 26/11/2026 | Session hết hạn tuyệt đối sau 480 phút (8 giờ); cookie `SameSite=Lax` | Người dùng phiên | residoken-wq/aidevteam#5 | NGƯỜI DÙNG PHIÊN ĐỒNG Ý — chờ `residoken-wq` xác nhận |
| D-2026-11-26-02 | 26/11/2026 | Giới hạn đăng nhập 5 lần / 15 phút / IP; vượt → 429 + audit | Người dùng phiên | residoken-wq/aidevteam#6 | NGƯỜI DÙNG PHIÊN ĐỒNG Ý — chờ `residoken-wq` xác nhận |
| D-2026-11-26-03 | 26/11/2026 | RBAC 0.1: 3 role `org_admin`/`maintainer`/`viewer` (`RBAC_MATRIX.md`); mặc định từ chối; gán role bằng CLI có audit | Người dùng phiên | residoken-wq/aidevteam#6 | NGƯỜI DÙNG PHIÊN ĐỒNG Ý — **CLAUDE.md §7: RBAC cần Owner duyệt** |
| D-2026-11-26-04 | 26/11/2026 | `secret_ref`: `env:AIDEV_SECRET_<NAME>` hoặc `file:/run/secrets/<name>`; 0.1 không resolve secret | Người dùng phiên | residoken-wq/aidevteam#7 | NGƯỜI DÙNG PHIÊN ĐỒNG Ý |
| D-2026-11-26-05 | 26/11/2026 | Redaction: không thêm mẫu token nội bộ PACE; chấp nhận che thừa mọi số 12 chữ số đứng riêng (coi như CCCD) | Người dùng phiên | Trả lời trong phiên | NGƯỜI DÙNG PHIÊN ĐỒNG Ý |
| D-2026-11-26-06 | 26/11/2026 | Làm Phase 0 rút gọn (tài liệu) trước khi tiếp tục P1-10/P1-11 để Owner có đủ hồ sơ ký ở checkpoint 27/11 | Người dùng phiên | Trả lời trong phiên ("làm tiếp A") | ÁP DỤNG |

## C. Checkpoint go/no-go (CLAUDE.md §5.4)

| Checkpoint | Ngày | Quyết định | Người quyết | Ghi chú |
|---|---|---|---|---|
| Phase 0 rút gọn | 26–27/11 | **CHỜ OWNER** | `residoken-wq` | Hồ sơ: `docs/reports/PHASE_0_REPORT.md`; ký theo `docs/governance/SIGNOFF_PHASE0.md` (review Approve trên PR phiếu ký) |
| Đầu vào hạ tầng | 27/11 | **CHỜ OWNER** | `residoken-wq` | Thiếu: domain, phiên bản DB, OAuth App |
| Feature freeze | 02/12 | — | | |
| Staging + UAT | 03/12 | — | | |
| Release dossier | 04/12 | — | | |
| Production | 05/12 | — | | |
