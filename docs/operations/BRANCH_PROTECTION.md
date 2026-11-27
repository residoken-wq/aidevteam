# Branch protection — định nghĩa (P1-09, O-02)

> **Trạng thái: `DEFINED – NOT ENFORCED (plan: free)`** — ghi ngày 27/11/2026.
> Repo đang ở tài khoản GitHub cá nhân, gói free. Owner quyết định nâng **GitHub Pro trước 05/12/2026** (DECISION_LOG, CLAUDE.md O-02); khi đó mới bật được protected branches cho private repo.
> Việc nâng gói và bật cấu hình là việc của **Owner** trên GitHub. Claude/agent **không** gọi API cấu hình GitHub, không sửa hay bypass rule (CLAUDE.md §0, §2).

## 1. Quy tắc cần bật

Áp dụng cho **`main`** và **`integration`** (branch `integration` chưa tồn tại — tạo khi có quy trình release train).

| Mục | Giá trị |
|---|---|
| Bắt buộc pull request trước khi merge | Bật — không push trực tiếp (CLAUDE.md §2 quy tắc 5) |
| Số người review bắt buộc | 1 người (Owner `residoken-wq` ở giai đoạn 1) — review của Claude/bot **không** tính (quy tắc 6) |
| Required status checks | `ci`, `claude-review` |
| Branch phải cập nhật với base trước khi merge | Bật |
| Cấm force push | Bật |
| Cấm xóa branch | Bật |
| Áp dụng cả với admin ("Do not allow bypassing the above settings") | Bật |

Ghi chú:
- `ci` (job trong `.github/workflows/ci.yml`) gồm: secret scan gitleaks (toàn bộ lịch sử), kiểm tra file bí mật, test deploy script, `pnpm audit --audit-level high`, lint, typecheck, unit test, script test, integration test, backup/restore test.
- `claude-review` **chưa tồn tại** (Phase 5 — để sau Release 0.1). Khi bật branch protection trước khi có job này, chỉ đặt `ci` là required; thêm `claude-review` khi job chạy ổn định. Ghi quyết định vào `DECISION_LOG.md`.
- Job `e2e` (QA-01) và `build (api)` / `build (web)` (`build-image.yml`) đang chạy trên mọi PR. **Đề xuất** (cần Owner quyết): thêm `e2e` vào required checks trước UAT 03/12.

## 2. Các bước Owner làm sau khi nâng Pro (UNVERIFIED — đối chiếu tài liệu GitHub tại thời điểm làm)

Tài liệu tham chiếu: https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches

1. Settings → Branches (hoặc Rules → Rulesets) → thêm rule cho `main` theo bảng mục 1.
2. Lặp lại cho `integration` khi branch được tạo.
3. Mở một PR thử: xác nhận nút merge bị khóa khi `ci` đỏ hoặc chưa có review.
4. Ghi kết quả + ảnh chụp cấu hình (không có token) vào `docs/reports/TEST_EVIDENCE.md`, đổi trạng thái ở đầu file này thành `ENFORCED` kèm ngày.

## 3. Trạng thái

| Hạng mục | Trạng thái |
|---|---|
| Định nghĩa rule | `DEFINED` (file này) |
| Bật trên GitHub | `NOT ENFORCED (plan: free)` — chờ Owner nâng Pro |
| Required check `ci` | Job tồn tại, chạy trên mọi PR |
| Required check `claude-review` | Chưa có job (post-0.1) |
| Kiểm chứng merge bị chặn | Chưa làm — sau khi bật |
