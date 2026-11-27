# QA-01 — E2E trình duyệt chạy trong CI (D-2026-11-26-08)

```text
TASK: QA-01 · Branch: ai/QA-01-e2e-ci · 1 PR · Hạn: trước feature freeze 02/12
Tham chiếu: tests/e2e/run-local.sh, tests/e2e/README.md, .github/workflows/ci.yml (service postgres pin digest)

LÀM
- Job mới "e2e" trong ci.yml (hoặc bước sau integration): postgres service như job ci, cài playwright đúng
  phiên bản đã dùng cục bộ (1.63.0 — xác nhận lại bằng npx playwright --version), cài chromium,
  chạy bash tests/e2e/run-local.sh. Pin action theo SHA; permissions: contents: read.
- Lưu log api/web (/tmp/e2e-*.log) làm artifact khi fail, KHÔNG upload trace/screenshot có cookie session.
- Lần chạy cục bộ 26/11 từng có 1 lần timeout không rõ nguyên nhân (residoken-wq/aidevteam#15). Nếu CI gặp lại:
  tìm nguyên nhân gốc, không thêm retry để che, không skip test.
- Cập nhật CLAUDE.md §11 và docs/operations/CICD.md.

AC
AC-1 CI chạy toàn bộ tests/e2e/*.e2e.cjs trên PR và xanh.
AC-2 Cố ý làm hỏng 1 assertion trong branch thử → job e2e FAIL (dán link run).
AC-3 Không secret thật; GITHUB_OAUTH_* trong job là giá trị giả như run-local.sh.
```
