# P2-02 — Dashboard tổng quan (dữ liệu thật)

```text
# TASK CARD: P2-02 — Dashboard tổng quan đọc dữ liệu thật trong org
Branch: ai/P2-02-dashboard
Nhãn: release-0.1, phase:2
Phụ thuộc: P2 CRUD, P3 Task, P4 mock dispatch

## Phạm vi (làm)
- Chỉ số: số project, agent, worker (theo trạng thái), task theo status, run gần nhất (SUCCESS/FAILED/
  INTERRUPTED), audit event gần nhất (đã lọc theo quyền).
- Mọi số liệu truy vấn từ DB theo org trong session. KHÔNG có số liệu hard-code/giả trên UI.
  Không có dữ liệu → hiển thị 0 / trạng thái rỗng, không hiển thị số mẫu.
- 1 endpoint aggregate có permission riêng (vd dashboard:read).

## Ngoài phạm vi
Cost analytics, SLI, biểu đồ lịch sử.

## Acceptance criteria
AC-1 Số liệu khớp dữ liệu seed giả (test so sánh với truy vấn đếm trực tiếp).
AC-2 User org A không thấy số liệu org B.
AC-3 Org rỗng → hiển thị trạng thái rỗng, không lỗi.
AC-4 Không có hằng số/mock data trong component dashboard (review + test).
```
