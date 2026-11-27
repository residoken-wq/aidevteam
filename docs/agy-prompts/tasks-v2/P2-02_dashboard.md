# P2-02 — Dashboard tổng quan (dữ liệu thật)

```text
TASK: P2-02 · Branch: ai/P2-02-dashboard · 1 PR · Phụ thuộc: P4 đã merge
Tham chiếu: workers.controller.ts (list), apps/web/app/workers/page.tsx, apps/web/app/page.tsx (nav)

LÀM
- GET /dashboard (permission dashboard:read, org từ session) trả số đếm bằng COUNT trong DB:
  projects (đang dùng), agents (bật/tắt), workers (bật/tắt), tasks theo status, runs 7 ngày theo status,
  5 run gần nhất (id, task number, project slug, status, finished_at). Không trả audit (cần audit:read riêng).
- Trang /dashboard + link ở trang chủ. Org rỗng → hiện 0 / "Chưa có dữ liệu".
- Không hằng số hay số liệu mẫu trong component; mọi số từ API.

AC
AC-1 Số liệu khớp truy vấn đếm trực tiếp trên dữ liệu giả (integration).
AC-2 Org A không thấy số liệu org B (cross-org test).
AC-3 Org rỗng → 200 với toàn số 0; UI hiện trạng thái rỗng (E2E).
AC-4 viewer xem được; người không có role → 403.
AC-5 E2E tests/e2e/dashboard.e2e.cjs: tạo 1 project + 1 task → số trên dashboard tăng đúng.
```
