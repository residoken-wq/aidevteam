# Release 0.1 — Release manifest (BẢN NHÁP)

> **Trạng thái: `DRAFT — CANDIDATE`** · Soạn 27/11/2026 (Asia/Ho_Chi_Minh) · Người soạn: Claude (AI, không phải người duyệt).
> Đây **không** phải approval. Bản này chỉ chốt ứng viên hiện tại. `target_sha` và digest sẽ được **chốt lại tại feature freeze 02/12** và manifest cuối được mở thành PR riêng để Owner comment `/approve-uat <digest>` / `/approve-production <digest>` (CLAUDE.md §5.5).
> Không có giá trị secret nào trong file này.

## 1. Định danh

| Trường | Giá trị | Trạng thái |
|---|---|---|
| Sản phẩm | AI Dev Team Control Center | — |
| Phiên bản | `0.1.0` | — |
| Ngày production dự kiến | 05/12/2026 | OWNER APPROVED (D-OWN, CLAUDE.md §4) |
| Repo | `residoken-wq/aidevteam` | — |
| `target_sha` (ứng viên) | `055007dc32e93b0d32d07b1670be40e400e86de1` (`main` sau PR #24) | **CANDIDATE** — chốt lại 02/12 |
| Image api | `ghcr.io/residoken-wq/aidevteam-api@sha256:f09a1d7aa04eb6d1a1e7e668fb8548ff0714399be48465cb83231b0099aab6f2` | build-image run 45991558374 (push `main`) |
| Image web | `ghcr.io/residoken-wq/aidevteam-web@sha256:09325bfd8d7e346c9a98e92eb92564205560850cdb877ad33324d6f1a61a9e65` | build-image run 45991558374 (push `main`) |
| `pipeline_run_id` | `45991558378` (ci) / `45991558374` (build-image) | ứng viên |
| `release_manifest_digest` | Chưa tính — xem §8 | **CHƯA CÓ** |
| Policy áp dụng | Release Policy v1.0.1 (đang hiệu lực) — **file `SOURCE_MISSING` trong repo** | **BLOCKER B-01** |

## 2. Phạm vi (CLAUDE.md §5.2)

Backlog `pnpm progress` ngày 27/11/2026: **Release 0.1: 6/6 Phase, 31/31 task (100%)**. Code-complete **trước** feature freeze 02/12.

| Hạng mục §5.2 | Task | PR |
|---|---|---|
| Repo skeleton, CI (lint, typecheck, test, SCA) | P1-01, P1-02, P1-09 | #3, #2, #24 |
| Đăng nhập GitHub OAuth (ADR-005) + RBAC default deny | P1-05G, P1-06 | #5, #6 |
| DB schema + migration có rollback, audit append-only | P1-04, P1-08 | #4 |
| Secret reference (không lưu plaintext) | P1-07 | #7 |
| Org / agent / provider account / worker / project CRUD | P2-03, P2-05, P2-07, P2-08, P2-10 | #15, #16, #13, #14, #12 |
| Task CRUD, trạng thái, Kanban cơ bản | P3-02, P3-04 | #17 |
| Dispatch tới mock worker, xem log/run | P4-01, P4-03, P4-07 | #19 |
| Dashboard tổng quan dữ liệu thật | P2-02 | #20 |
| Approval Center chỉ đọc (O-07) | P6-06 | #23 |
| Health probe, backup/restore cơ bản | P1-10, P1-11 | #10, #11 |
| E2E trình duyệt trong CI | QA-01 | #21 |
| Tài liệu Phase 0, runbook agent | P0, AGY | #1, #8, #9, #18 |

**Ngoài phạm vi 0.1** (để sau): Phase 5 claude-review loop, approval service xác minh comment (P6-05/P6-08), worker thật/AGY, role editor (P2-04), org chart kéo thả (P2-06), UI audit log (S-11), CSKH, Docs/Codex.
**Ràng buộc:** Control Center 0.1 không điều khiển release sản phẩm khác và không giữ production secret của HULA/TDCX hay sản phẩm khác.

## 3. Danh sách PR đã merge vào `main`

| PR | Ngày merge | Merge commit | Nội dung |
|---|---|---|---|
| #1 | 25/11 | `58c935b` | [P0-AGY] CLAUDE.md + prompt pack |
| #2 | 25/11 | `2503dc4` | [P1-09] build image GHCR + deploy theo digest |
| #3 | 25/11 | `689ee63` | [P1-01] monorepo skeleton |
| #4 | 26/11 | `c3ad568` | [P1-04][P1-08] schema, migration up/down, audit append-only |
| #5 | 26/11 | `a415d84` | [P1-05G] GitHub OAuth + PKCE, allowlist, session phía server |
| #6 | 26/11 | `8308077` | [P1-06] RBAC default deny, 3 role, rate limit đăng nhập |
| #7 | 26/11 | `bf9f7ac` | [P1-07] secret_ref + redact |
| #8 | 26/11 | `faaf775` | [P0] baseline Phase 0 |
| #9 | 26/11 | `7e22569` | [P0] phiếu ký baseline |
| #10 | 26/11 | `7ce3542` | [P1-10] health/readiness |
| #11 | 26/11 | `92a359f` | [P1-11] backup/restore có test |
| #12 | 26/11 | `b943d7f` | [P2-10] project CRUD + E2E |
| #13 | 26/11 | `a6f3a98` | [P2-07] provider account (secret_ref) |
| #14 | 26/11 | `2041193` | [P2-08] worker mock |
| #15 | 26/11 | `1e28acd` | [P2-03] quản trị org (platform admin) |
| #16 | 26/11 | `9a58b22` | [P2-05] agent + sơ đồ báo cáo |
| #17 | 27/11 | `e357794` | [P3-02][P3-04] task + Kanban |
| #18 | 27/11 | `ebdcce2` | runbook AGY, task card, báo cáo tiến độ |
| #19 | 27/11 | `b00854b` | [P4-01/03/07] mock dispatch |
| #20 | 27/11 | `2c90d9e` | [P2-02] dashboard |
| #21 | 27/11 | `9480dd0` | [QA-01] E2E trong CI; sửa session E2E và kéo thả Kanban |
| #23 | 27/11 | `396b0e8` | [P6-06] Approval Center chỉ đọc |
| #24 | 27/11 | `055007d` | [P1-09] secret scan, SCA, định nghĩa branch protection |

PR #22, #25, #26: PR nháp kiểm tra ngược (cố ý làm FAIL), **đã đóng, không merge**.
Mọi PR được merge sau khi người dùng phiên đồng ý (D-2026-11-25-03). Review của Claude/bot **không** tính là approval (CLAUDE.md §2 quy tắc 6) — xem R-21.

## 4. Kết quả CI trên `target_sha` ứng viên

| Workflow / job | Run | Kết quả |
|---|---|---|
| `ci` / `ci` (secret scan gitleaks, hygiene, deploy script test, `pnpm audit --audit-level high`, lint, typecheck, unit, script, integration, backup/restore) | 45991558378 | ✅ success |
| `ci` / `e2e` (9 file Playwright) | 45991558378 | ✅ success |
| `build-image` / `build (api)`, `build (web)` | 45991558374 | ✅ success, push GHCR |

Bằng chứng kiểm tra ngược (chứng minh gate biết FAIL): E2E run 45986565988 · SCA run 45990024360 · secret scan run 45990180141.

## 5. Migration

| Thứ tự | Migration | Ghi chú |
|---|---|---|
| 0001 | `init` | users, orgs, roles, sessions, audit append-only, `release_approvals` append-only (có `environment`) |
| 0002–0006 | auth/RBAC, rate limit, projects, provider accounts, workers | theo PR #4–#14 |
| 0007 | `platform_admins` | P2-03 |
| 0008 | `agents` | P2-05 |
| 0009 | `tasks` + trigger trạng thái | P3-02 |
| 0010 | `agent_runs` + trigger trạng thái | P4-01 |

- Mọi migration có cặp up/down, được integration test chạy hai chiều.
- **Production lần đầu:** DB trống → chạy `migrate up` toàn bộ **trước** khi khởi động image (`/health/ready` trả 503 khi schema lệch — CICD.md §4).
- Rollback migration xóa dữ liệu và bị chặn khi `NODE_ENV=production`. Rollback release 0.1 = quay image, **không** chạy `migrate down` trên production (xem §7).

## 6. Bằng chứng staging / UAT

| Hạng mục | Trạng thái |
|---|---|
| Staging chạy đúng `target_sha` | **CHƯA CÓ** — domain/môi trường staging `CHƯA CẤU HÌNH` (ENVIRONMENT_INVENTORY) |
| E2E trên staging | **CHƯA CÓ** |
| UAT ký bởi `residoken-wq` | **CHƯA CÓ** — checklist: `docs/releases/0.1/UAT_CHECKLIST.md` |

## 7. Kế hoạch rollback

1. **Trước deploy:** backup DB production bằng `deploy/backup.sh`, ghi tên file + checksum vào post-release report (không ghi secret).
2. **Health check lỗi khi deploy:** `deploy.sh` tự quay về `release.prev.env` và thoát mã 1.
3. **Rollback chủ động:** `sudo /opt/aidevteam/deploy.sh --rollback --health-url http://127.0.0.1:3001/health/ready` (CICD.md §4).
4. **Release đầu tiên** chưa có bản trước, nên `--rollback` không có gì để quay về → **đề xuất**: người vận hành dừng stack và khôi phục DB từ backup bước 1 bằng `deploy/restore.sh` vào DB rỗng. Lệnh dừng stack chưa có trong `deploy.sh`/CICD.md — cần soạn và test trước 04/12; Owner xác nhận chấp nhận phương án (**OPEN**).
5. **Không** chạy `migrate down` trên production; lỗi schema → khôi phục từ backup.

## 8. Digest của manifest (`release_manifest_digest`)

Đề xuất (cần đối chiếu với Release Policy khi có file — **UNVERIFIED**): digest = SHA-256 của file manifest **cuối** tại commit PR manifest, định dạng `sha256:<64 hex>` (khớp ràng buộc cột `release_approvals.release_manifest_digest`). Digest không ghi trong chính file (sẽ tự thay đổi), mà ghi trong mô tả PR manifest và `APPROVAL_RECORD.md`.

```bash
printf 'sha256:%s\n' "$(git show <manifest_pr_head_sha>:docs/releases/0.1/RELEASE_MANIFEST.md | sha256sum | cut -d' ' -f1)"
```

## 9. Go/No-Go theo checkpoint (CLAUDE.md §5.4, §5.5)

| # | Điều kiện | Hạn | Trạng thái 27/11 |
|---|---|---|---|
| G-01 | Phạm vi §5.2 có PR đã review | 02/12 | ✅ 31/31 task merged |
| G-02 | Staging chạy, E2E phạm vi 0.1 pass trên staging | 03/12 | ❌ staging `CHƯA CẤU HÌNH` |
| G-03 | UAT ký bởi `residoken-wq` | 03/12 | ❌ chưa làm |
| G-04 | GitHub Pro + branch protection `main` bật | 04/12 | ❌ `DEFINED – NOT ENFORCED (plan: free)` |
| G-05 | v1.0.2 xác nhận **hoặc** Owner ký ngoại lệ bằng văn bản cho 0.1 | 04/12 | ❌ chưa có — thiếu cả hai → **NO_GO** |
| G-06 | Manifest cuối có SHA, digest, rollback plan | 04/12 | 🟡 bản nháp này |
| G-07 | OAuth App production đăng ký, callback đúng domain | trước staging | ❌ `CHƯA CẤU HÌNH` |
| G-08 | `ttl_minutes` có giá trị (đang `null` → **chặn deploy**, D-OWN-10) | 04/12 | ❌ `CHƯA CẤU HÌNH` |
| G-09 | Owner duyệt đúng SHA + digest (`/approve-uat`, `/approve-production`) | 05/12 | ❌ chưa tới bước |

### Blocker

| ID | Blocker | Ai xử lý |
|---|---|---|
| B-01 | Release Policy v1.0.1/v1.0.2 và `approval-policy.yaml` **`SOURCE_MISSING`** trong repo → không đối chiếu được 9 trường approval record và quy tắc digest | Owner đưa file vào repo |
| B-02 | Staging + domain production/staging `CHƯA CẤU HÌNH` | Owner |
| B-03 | OAuth App chưa đăng ký | Owner |
| B-04 | `ttl_minutes = null` chặn deploy | Owner (D-OWN-10) |
| B-05 | GitHub Pro + branch protection | Owner |
| B-06 | v1.0.2 chưa xác nhận / chưa có ngoại lệ bằng văn bản | Owner |

**Kết luận hiện tại (27/11): code-complete; release production `NO_GO` cho tới khi B-01…B-06 được xử lý.** Chưa đề xuất dời ngày — còn 6 ngày tới hạn 04/12; nếu B-02 chưa xong vào 02/12 thì UAT 03/12 không kịp → đề xuất dời.

## 10. Rủi ro còn mở liên quan release

R-11/R-24 (Owner chưa bật 2FA; token `gh` của Owner trên máy điều phối), R-19 (chưa có branch protection), R-21 (một người vừa review vừa đồng ý merge), R-23 (platform admin; D-2026-11-26-13 chờ ký), R-25 (agent sửa guard). Chi tiết: `docs/governance/RISKS.md`.
