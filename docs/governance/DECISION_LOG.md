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
| D-OWN-21 | Tech stack | ADR-001/002/003/004/005 — xem mục B và D-2026-11-26-07 | OWNER APPROVED (26/11) |

## B. Quyết định phát sinh trong quá trình thực hiện

| ID | Ngày | Quyết định | Người quyết | Bằng chứng | Trạng thái |
|---|---|---|---|---|---|
| D-2026-11-25-01 | 25/11/2026 | Cho phép bắt đầu code Phase 1 (từ P1-01) **trước khi** Owner ký baseline Phase 0 — ngoại lệ với CLAUDE.md §7 | Người dùng phiên; **Owner ký 26/11** | residoken-wq/aidevteam#3; residoken-wq/aidevteam#9 review 6068795161 (mục 2) | **OWNER APPROVED** |
| D-2026-11-25-02 | 25/11/2026 | ADR-001 (Next.js) và ADR-002 (NestJS + Zod, pnpm, Node 24 LTS) → `ACCEPTED` | Người dùng phiên; **Owner ký 26/11** | residoken-wq/aidevteam#3; residoken-wq/aidevteam#9 review 6068795161 (mục 3) | **OWNER APPROVED** |
| D-2026-11-25-03 | 25/11/2026 | PR có CI xanh → Claude hỏi; người dùng đồng ý rõ ràng từng PR → Claude thực hiện thao tác merge. Câu trả lời đồng ý = quyết định review của người dùng (không phải review của Claude) | Người dùng phiên | Trả lời trong phiên | ÁP DỤNG |
| D-2026-11-25-04 | 25/11/2026 | CI/CD: GitHub build image lên ghcr.io; VPS `192.168.250.30` pull theo digest, chạy thủ công sau approval; web publish `:3301` cho NPM `192.168.250.10` | Người dùng phiên | residoken-wq/aidevteam#2 | ĐÃ MERGE |
| D-2026-11-25-05 | 25/11/2026 | ADR-004: Drizzle ORM + migration SQL up/down tự quản lý → `ACCEPTED` | Người dùng phiên; **Owner ký 26/11** | residoken-wq/aidevteam#4; residoken-wq/aidevteam#9 review 6068795161 (mục 3) | **OWNER APPROVED** |
| D-2026-11-26-01 | 26/11/2026 | Session hết hạn tuyệt đối sau 480 phút (8 giờ); cookie `SameSite=Lax` | Người dùng phiên; **Owner ký 26/11** | residoken-wq/aidevteam#5; residoken-wq/aidevteam#9 review 6068795161 (mục 6) | **OWNER APPROVED** |
| D-2026-11-26-02 | 26/11/2026 | Giới hạn đăng nhập 5 lần / 15 phút / IP; vượt → 429 + audit | Người dùng phiên; **Owner ký 26/11** | residoken-wq/aidevteam#6; residoken-wq/aidevteam#9 review 6068795161 (mục 6) | **OWNER APPROVED** |
| D-2026-11-26-03 | 26/11/2026 | RBAC 0.1: 3 role `org_admin`/`maintainer`/`viewer` (`RBAC_MATRIX.md`); mặc định từ chối; gán role bằng CLI có audit | Người dùng phiên; **Owner ký 26/11** | residoken-wq/aidevteam#6; residoken-wq/aidevteam#9 review 6068795161 (mục 5) | **OWNER APPROVED** |
| D-2026-11-26-04 | 26/11/2026 | `secret_ref`: `env:AIDEV_SECRET_<NAME>` hoặc `file:/run/secrets/<name>`; 0.1 không resolve secret | Người dùng phiên | residoken-wq/aidevteam#7 | NGƯỜI DÙNG PHIÊN ĐỒNG Ý |
| D-2026-11-26-05 | 26/11/2026 | Redaction: không thêm mẫu token nội bộ PACE; chấp nhận che thừa mọi số 12 chữ số đứng riêng (coi như CCCD) | Người dùng phiên | Trả lời trong phiên | NGƯỜI DÙNG PHIÊN ĐỒNG Ý |
| D-2026-11-26-06 | 26/11/2026 | Làm Phase 0 rút gọn (tài liệu) trước khi tiếp tục P1-10/P1-11 để Owner có đủ hồ sơ ký ở checkpoint 27/11 | Người dùng phiên | Trả lời trong phiên ("làm tiếp A") | ÁP DỤNG |
| D-2026-11-26-07 | 26/11/2026 | **Owner ký baseline Phase 0** (phiếu `SIGNOFF_PHASE0.md`, 9 mục): (1) baseline artefact Phase 0; (2) ngoại lệ code trước baseline; (3) ADR-001/002/004; (4) **ADR-003 job table PostgreSQL**; (5) RBAC 3 role; (6) session 8h + 5 lần/15 phút/IP; (7) **máy trạng thái Task và Agent run**; (8) cam kết xác nhận v1.0.2 trước 04/12 hoặc ký ngoại lệ; (9) phạm vi 0.1 + thứ tự cắt giảm | `residoken-wq` (ID 228839459) | residoken-wq/aidevteam#9 review 6068795161 | **OWNER APPROVED** |
| D-2026-11-26-08 | 26/11/2026 | Đưa E2E trình duyệt (Playwright) vào CI cho các màn hình Release 0.1, hoàn thành trước UAT 03/12 | Người dùng phiên | Trả lời trong phiên (residoken-wq/aidevteam#12) | NGƯỜI DÙNG PHIÊN ĐỒNG Ý |
| D-2026-11-26-09 | 26/11/2026 | Web proxy `/api/*` → api (session, RBAC, `Origin` vẫn do api kiểm tra) | Người dùng phiên | residoken-wq/aidevteam#12 | NGƯỜI DÙNG PHIÊN ĐỒNG Ý |
| D-2026-11-26-10 | 26/11/2026 | Thứ tự làm tiếp: P2-07 (provider account) → P2-08 (worker) → … | Người dùng phiên | Trả lời trong phiên | ÁP DỤNG |
| D-2026-11-26-11 | 26/11/2026 | Danh sách provider 0.1: `anthropic`, `openai` (OpenAI Codex), `google`, `github`, `other` | Người dùng phiên | Trả lời trong phiên (residoken-wq/aidevteam#13) | NGƯỜI DÙNG PHIÊN ĐỒNG Ý |
| D-2026-11-26-13 | 26/11/2026 | P2-03: thêm **platform admin** (người, không phải role trong org; cấp/gỡ bằng CLI có audit) với `platform:org:read`/`platform:org:write` để tạo, đổi tên, lưu trữ, khôi phục org qua UI. Không có quyền xem dữ liệu trong org. **Thay đổi mô hình RBAC Owner đã ký (D-2026-11-26-07 mục 5)** | Người dùng phiên | Trả lời trong phiên | NGƯỜI DÙNG PHIÊN ĐỒNG Ý — **REQUIRES_OWNER_APPROVAL** trước UAT 03/12 |
| D-2026-11-26-14 | 26/11/2026 | Lưu trữ org: chặn mọi truy cập trong org, **không** thu hồi session (người dùng chọn org khác được), giữ dữ liệu, khôi phục được | Người dùng phiên | Trả lời trong phiên | NGƯỜI DÙNG PHIÊN ĐỒNG Ý |
| D-2026-11-27-01 | 27/11/2026 | Từ P4 trở đi, code các task còn lại của Release 0.1 bằng **AGY do người vận hành dùng** (cách A) theo `docs/agy-prompts/AGY_RUNBOOK.md`: QA đơn giản (test theo AC, 5 lệnh, kiểm tra ngược chốt bảo mật, 6 mục tự kiểm), tiết kiệm token, báo cáo thời gian + tiến độ sau mỗi task. Người vẫn review và quyết định merge từng PR; không tích hợp AGY vào sản phẩm (§2 quy tắc 8). O-06: chỉ đưa code repo vào AGY | Người dùng phiên | Trả lời trong phiên | NGƯỜI DÙNG PHIÊN ĐỒNG Ý |
| D-2026-11-27-02 | 27/11/2026 | O-06: cho phép chạy **Antigravity CLI `agy` ở chế độ headless** (`agy -p`) trên máy điều phối để code các task Release 0.1. Agent chạy dưới guard PreToolUse (chặn push, đọc `.env`/biến môi trường, gọi mạng ngoài, sửa guard); agent không push, Claude QA rồi push. `provider_terms` vẫn `UNVERIFIED`; chỉ đưa code repo, không secret/dữ liệu thật/D4 | Người dùng phiên | Trả lời trong phiên | NGƯỜI DÙNG PHIÊN ĐỒNG Ý |
| D-2026-11-27-03 | 27/11/2026 | Ngoại lệ tạm thời quy tắc 4 đến **15/01/2027**: Claude dùng `gh`/git của Owner `residoken-wq` trên máy điều phối để push branch `ai/*`, mở PR, đọc CI, merge khi được đồng ý từng PR. Không áp dụng cho agent, CI, script nền. Sau 15/01/2027 dùng tài khoản máy riêng | Người dùng phiên | Trả lời trong phiên | NGƯỜI DÙNG PHIÊN ĐỒNG Ý — hết hạn 15/01/2027 |
| D-2026-11-27-04 | 27/11/2026 | Code post-0.1 (Phase 2: P2-04, P2-06; các phase sau) **được merge vào `main` trước 05/12** sau khi người review. Release 0.1 vẫn deploy đúng `target_sha` + digest image đã ghim trong `docs/releases/0.1/RELEASE_MANIFEST.md`; nếu cần vá 0.1 thì tách branch từ `target_sha` đó | Người dùng phiên | Trả lời trong phiên | NGƯỜI DÙNG PHIÊN ĐỒNG Ý |
| D-2026-11-28-01 | 28/11/2026 | P2-09, P1-03, P2-11 làm **theo đề xuất** của Claude: license status provider account (`approved`/`unverified`/`prohibited`, mặc định `unverified`, chỉ `org_admin` đổi — permission `provider_account:license`); OpenAPI sinh từ Zod không thêm dependency; trang hồ sơ chỉ đọc, chỉ tiếng Việt, a11y kiểm bằng E2E. RBAC mới vẫn `REQUIRES_OWNER_APPROVAL` cho tới khi Owner xác nhận riêng | Người dùng phiên | Trả lời trong phiên (residoken-wq/aidevteam#36, #37, #38) | NGƯỜI DÙNG PHIÊN ĐỒNG Ý |
| D-2026-11-28-02 | 28/11/2026 | "Assigned-project access" (acceptance P2-12) **tách thành task riêng P2-13** (quyền theo project); P2-12 ghi mục này `NOT MODELLED`. Thiết kế P2-13 ảnh hưởng RBAC → chờ Owner duyệt trước khi giao agent | Người dùng phiên | Trả lời trong phiên | NGƯỜI DÙNG PHIÊN ĐỒNG Ý |
| D-2026-11-28-03 | 28/11/2026 | Thêm bước `pnpm openapi:check` vào job `ci` | Người dùng phiên | Trả lời trong phiên (residoken-wq/aidevteam#39) | NGƯỜI DÙNG PHIÊN ĐỒNG Ý |
| D-2026-11-28-04 | 28/11/2026 | P2-13 chọn **phương án A**: role org mới `project_member` + bảng `project_assignments` (`read`/`write`), permission `project:assign` chỉ `org_admin`; role cũ giữ quyền toàn org. RBAC mới vẫn `REQUIRES_OWNER_APPROVAL` | Người dùng phiên | Trả lời trong phiên (residoken-wq/aidevteam#42) | NGƯỜI DÙNG PHIÊN ĐỒNG Ý |
| D-2026-11-28-05 | 28/11/2026 | Máy 2 chuyển sang **Cách 2**: agy chạy bằng Scheduled Task `aidevteam-agy` trong phiên desktop đang đăng nhập của `Administrator` (đăng nhập Google qua SSH không bền — R-26) | Người dùng phiên | Trả lời trong phiên | NGƯỜI DÙNG PHIÊN ĐỒNG Ý |
| D-2026-11-28-06 | 28/11/2026 | Phase 2 hoàn tất (13/13 task merged); **chuyển sang Phase 3** | Người dùng phiên | Trả lời trong phiên | NGƯỜI DÙNG PHIÊN ĐỒNG Ý |
| D-2026-11-26-12 | 26/11/2026 | `viewer` được xem `secret_ref` (tham chiếu, không phải secret; có lộ tên biến môi trường) — chấp nhận | Người dùng phiên | Trả lời trong phiên (residoken-wq/aidevteam#13) | NGƯỜI DÙNG PHIÊN ĐỒNG Ý |

## C. Checkpoint go/no-go (CLAUDE.md §5.4)

| Checkpoint | Ngày | Quyết định | Người quyết | Ghi chú |
|---|---|---|---|---|
| Phase 0 rút gọn | 26/11/2026 | **GO — OWNER APPROVED ALL 1-9** | `residoken-wq` (GitHub user ID 228839459) | Review [6068795161](https://github.com/residoken-wq/aidevteam/pull/9#pullrequestreview-6068795161) nội dung `/signoff-phase0 APPROVE ALL 1-9`, 05:02:08Z, commit `f3dc9e5` (kèm review Approve không ghi chú 6068765839, 04:58:23Z). Xác minh qua GitHub API: login, ID số, `author_association: OWNER`, `state: APPROVED` |
| Đầu vào hạ tầng | 27/11 | **CHỜ OWNER** | `residoken-wq` | Thiếu: domain, phiên bản DB, OAuth App |
| Feature freeze | 02/12 | — | | |
| Staging + UAT | 03/12 | — | | |
| Release dossier | 04/12 | — | | |
| Production | 05/12 | — | | |
