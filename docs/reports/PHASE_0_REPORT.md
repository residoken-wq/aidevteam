# PHASE 0 REPORT — checkpoint 26–27/11/2026

> Ngày lập: 26/11/2026 · Người lập: Claude (AI Engineering Manager) · **Cần Owner `residoken-wq` ký**
> Mẫu §15 Master Plan: `SOURCE_MISSING` — báo cáo theo cấu trúc CLAUDE.md §7 mục 10 và §10.

## 1. Tóm tắt điều hành
- Phase 0 rút gọn được làm **sau** một phần Phase 1 (ngoại lệ D-2026-11-25-01, chưa có Owner xác nhận). Hồ sơ Phase 0 nay đã đủ để Owner xem xét.
- **Đã merge vào `main`** (7 PR): CI/CD, repo skeleton, DB + audit append-only, đăng nhập GitHub OAuth, RBAC default deny + giới hạn đăng nhập, secret_ref + redaction. Mọi PR có CI xanh và được người dùng phiên đồng ý merge.
- **8 nguồn tài liệu gốc chưa có trong repo** (Master Plan, policy v1.0.1/v1.0.2…). Đây là blocker cho việc đối chiếu AC và cho release 05/12 (§5.5).
- **Đánh giá 05/12: `AT RISK`** — xem §4.

## 2. Artefact Phase 0

| Task | Artefact | Trạng thái |
|---|---|---|
| P0-01 | `docs/reports/SOURCE_INVENTORY.md` | Xong — 8 `SOURCE_MISSING` |
| P0-02 | `docs/reports/ENVIRONMENT_INVENTORY.md` | Xong — nhiều mục `CHƯA CẤU HÌNH` |
| P0-03 | `docs/operations/THREAT_MODEL.md` | Xong |
| P0-04 | `docs/operations/PROVIDER_COMPLIANCE.md` | Xong — không kết luận pháp lý |
| P0-05 | `docs/architecture/ADR-001..005` | ADR-001/002/004 `ACCEPTED` (người dùng phiên), **ADR-003 `PROPOSED`**, ADR-005 `ACCEPTED` (Owner) |
| P0-06 | `docs/governance/RBAC_MATRIX.md` | Người dùng phiên đồng ý — **cần Owner duyệt** |
| P0-07 | `docs/ux/UX_FLOWS.md` | Xong |
| O-04 | `docs/architecture/STATE_MACHINES.md` | `PROPOSED` — tên trạng thái release chờ policy |
| P0-08 | `docs/backlog/issues-import.json` + `.csv` | Xong — 38 mục, chỉ Task ID có trong CLAUDE.md; không tạo issue GitHub |
| §7.10 | `DECISION_LOG.md`, `RISKS.md`, `TEST_EVIDENCE.md`, báo cáo này | Xong |

## 3. Phạm vi Release 0.1 cuối cùng (đề xuất, giữ nguyên CLAUDE.md §5.2)

| Hạng mục | Task | Trạng thái 26/11 |
|---|---|---|
| Repo skeleton, CI | P1-01, P1-02, P1-09 | Merged; **P1-09 thiếu SCA + secret scan** |
| Đăng nhập + RBAC | P1-05G, P1-06 | Merged; chờ OAuth App + Owner duyệt RBAC |
| DB + audit append-only | P1-04, P1-08 | Merged |
| Secret reference | P1-07 | Merged |
| CRUD org/agent/provider account/worker/project | P2-03, P2-05, P2-07, P2-08, P2-10 | TODO |
| Task + Kanban | P3-02, P3-04 | TODO — cần duyệt STATE_MACHINES §1 |
| Dispatch mock worker | P4-01, P4-03, P4-07 | TODO — cần duyệt ADR-003 |
| Dashboard | P2-02 | TODO |
| Approval Center chỉ đọc | P6-06 | TODO |
| Health + backup/restore | P1-10, P1-11 | TODO |

## 4. Đánh giá tiến độ và đề xuất go/no-go

**Còn lại trước feature freeze 02/12 (6 ngày):** 14 task + phần còn lại của P1-09. Đây là ước lượng rủi ro, không phải cam kết năng suất.

Thứ tự đề xuất (theo phụ thuộc): P1-10 → P2-10/P2-03 → P2-05/P2-07/P2-08 → P3-02/P3-04 → P4 → P2-02 → P6-06 → P1-11 → P1-09 (SCA).

**Điểm kiểm tra sớm 30/11:** nếu P2 (5 CRUD) chưa merge, đề xuất cắt khỏi 0.1 theo thứ tự: P2-02 (dashboard) → P4-07 (xem log chi tiết) → P3-04 (Kanban kéo thả; giữ danh sách + đổi trạng thái). **Không cắt** đăng nhập, RBAC, audit, redaction, health/backup (quy tắc cứng 12).

**Điều kiện bắt buộc cho 05/12 nằm ngoài code** (thiếu bất kỳ mục nào → `NO_GO`):
1. Policy v1.0.2 được xác nhận **hoặc** Owner ký ngoại lệ bằng văn bản (§5.5).
2. GitHub Pro + branch protection `main` (O-02).
3. Staging chạy được: domain, DB, OAuth App, tài khoản máy ghcr.io, `app.env`, rule `DOCKER-USER`.
4. `residoken-wq` ký UAT 03/12.

## 5. Blocker cho checkpoint 27/11

| # | Blocker | Ai |
|---|---|---|
| B-1 | 8 nguồn `SOURCE_MISSING` (Master Plan, policy v1.0.1/v1.0.2, proposals, router) | Owner |
| B-2 | Domain production/staging; phiên bản và vị trí PostgreSQL production | Owner |
| B-3 | Đăng ký GitHub OAuth App (callback theo domain) | Owner |
| B-4 | Xác nhận các quyết định người dùng phiên đã đưa ra (DECISION_LOG mục B) | Owner |
| B-5 | Duyệt RBAC_MATRIX, STATE_MACHINES §1–2, ADR-003 (cần cho P3, P4) | Owner |

## 6. Quyết định Owner cần ký

| # | Quyết định | Tham chiếu |
|---|---|---|
| 1 | Baseline Phase 0 (các artefact §2) | Báo cáo này |
| 2 | Ngoại lệ đã code trước baseline | D-2026-11-25-01 |
| 3 | ADR-001 Next.js, ADR-002 NestJS/Zod/pnpm/Node 24, ADR-004 Drizzle | D-2026-11-25-02, -05 |
| 4 | ADR-003 job table PostgreSQL cho 0.1 | `ADR-003-queue.md` |
| 5 | RBAC 3 role | D-2026-11-26-03, `RBAC_MATRIX.md` |
| 6 | Session 8 giờ; giới hạn đăng nhập 5 lần/15 phút/IP | D-2026-11-26-01, -02 |
| 7 | Máy trạng thái Task và Agent run | `STATE_MACHINES.md` |
| 8 | Xác nhận policy v1.0.2 trước 04/12 (hoặc ngoại lệ) | D-OWN-15, §5.5 |
| 9 | Phạm vi 0.1 cuối cùng + thứ tự cắt giảm nếu trễ (§4) | Báo cáo này |

## Owner cần kiểm tra
- [ ] Ký hoặc từ chối từng mục §6 — ghi kết quả vào `DECISION_LOG.md` mục C.
- [ ] Gỡ blocker §5 trước 27/11.
- [ ] Đọc `RISKS.md` R-11..R-15 (mức Cao).
