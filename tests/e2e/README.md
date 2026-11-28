# Browser E2E (Playwright)

| Test | Phạm vi |
|---|---|
| `provider-accounts.e2e.cjs` | P2-07: tạo → dán nhầm secret bị từ chối, có hướng dẫn và bị xóa khỏi trang → đổi tham chiếu → lưu trữ; viewer chỉ đọc |
| `binding-rules.e2e.cjs` | P2-09: org_admin đổi account sang approved → maintainer gắn được vào agent; account prohibited → gắn bị từ chối (thấy thông báo lỗi) |
| `workers.e2e.cjs` | P2-08: tạo worker mock gắn dự án → đường dẫn lồng nhau / thư mục hệ thống bị từ chối → tắt/bật → lưu trữ giải phóng đường dẫn; viewer chỉ đọc |
| `agents.e2e.cjs` | P2-05: tạo sơ đồ agent có tài khoản provider và cấp trên → vòng lặp bị từ chối → không lưu trữ được agent còn cấp dưới → gỡ cấp dưới rồi lưu trữ; viewer chỉ đọc |
| `tasks.e2e.cjs` | P3-02/P3-04: Kanban — HTML trong task hiển thị dạng text → kéo thả BACKLOG→TODO → kéo sai bị từ chối → đi tới DONE có xác nhận → hủy có lý do → bảng cũ nhận 409 và tải lại; viewer chỉ đọc |
| `platform-orgs.e2e.cjs` | P2-03: platform admin tạo org → trùng mã báo lỗi → đổi tên → lưu trữ → khôi phục; maintainer không thấy link và bị từ chối |
| `projects.e2e.cjs` | P2-10 AC-8: tạo → đổi tên → lưu trữ dự án qua UI; lỗi trùng slug; tên chứa HTML hiển thị dạng chữ; viewer không thấy nút ghi và gọi API trực tiếp bị 403 |
| `runs.e2e.cjs` | P4-07: Dispatch mock từ Kanban → trang run hiện QUEUED; viewer không thấy nút Hủy và form Chạy mock; id sai → 404 |
| `org-chart.e2e.cjs` | P2-06: Sơ đồ tổ chức agent — kéo thả đổi quản lý, phát hiện và chặn vòng lặp, select bàn phím đưa về gốc; viewer chỉ xem |
| `dashboard.e2e.cjs` | P2-02: org mới → dashboard hiện 0 và "Chưa có dữ liệu"; tạo 1 project + 1 task → số project đang dùng và số task BACKLOG tăng đúng 1 |
| `approvals.e2e.cjs` | P6-06: Approval Center chỉ đọc — banner + "Chưa có bản ghi duyệt" khi rỗng; chèn bản ghi giả qua psql → hiện đủ cột, đúng environment, không có button/form, không có link github khi chưa cấu hình APPROVAL_REPO; viewer xem được |
| `members.e2e.cjs` | P2-04: org_admin gán role viewer cho user allowlist → thấy trong bảng → gỡ → biến mất; maintainer không có quyền xem |
| `app-shell.e2e.cjs` | P2-01: App shell — sidebar theo RBAC, header có logout, mobile viewport không cuộn ngang, aria-current="page" |

## Chạy cục bộ

Cần PostgreSQL (trust auth, DB tạm tên `e2e_ui_test` sẽ bị xóa/tạo lại) và gói `playwright` (có sẵn trong image Claude Code cloud; **chưa** là dependency của repo).

```bash
PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres NODE_PATH="$(npm root -g)" bash tests/e2e/run-local.sh
```

Runner build api + web, migrate + seed dữ liệu giả, tạo session giả cho user seed, chạy api (`:3911`) và web standalone (`:3910`), chạy mọi `*.e2e.cjs`, rồi dừng server.

## Trong CI
Job `e2e` trong `.github/workflows/ci.yml` (QA-01) chạy runner này trên mọi PR: cài `playwright@1.63.0` global + Chromium, `NODE_PATH="$(npm root -g)"`, PostgreSQL service ghim digest. Khi fail chỉ upload log api/web, không upload trace/screenshot.
