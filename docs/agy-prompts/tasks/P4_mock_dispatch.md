# P4-01 / P4-03 / P4-07 (rút gọn) — Dispatch tới mock worker, xem run/log

```text
# TASK CARD: P4-01/P4-03/P4-07 — Job table PostgreSQL + mock worker + xem run/log
Branch: ai/P4-01-mock-dispatch
Nhãn: release-0.1, phase:4
Phụ thuộc: P2 Worker, P3 Task, STATE_MACHINES.md (máy trạng thái "agent run")
ADR cần ACCEPTED: ADR-003 (queue). Release 0.1: job table trong PostgreSQL.

## Bối cảnh
KHÔNG tích hợp AGY/Antigravity thật, KHÔNG gọi provider AI, KHÔNG chạy lệnh từ nội dung task.
Router v0.1 (docs/source/AGY_MCP_Router_MVP_v0.1/) chỉ là tài liệu tham khảo — áp dụng ý tưởng tốt,
tránh 11 điểm yếu ở CLAUDE.md §6.2.

## Phạm vi (làm)
- Bảng agent_runs (org_id, task_id, worker_id, status, attempt, started_at, finished_at,
  output_summary đã redact, error_code). Giới hạn độ dài hàng đợi theo org (khắc phục 6.2-8): vượt → 429.
- Dispatch: POST /tasks/:id/dispatch {worker_id} — kiểm tra worker cùng org, type=mock, worker không bận.
- Mock worker: tiến trình nội bộ lấy job bằng SELECT ... FOR UPDATE SKIP LOCKED (kiểm tra cú pháp theo
  tài liệu PostgreSQL), giả lập kết quả xác định (SUCCESS/FAILED/timeout theo cấu hình test).
  KHÔNG spawn shell. Nếu cần subprocess để mô phỏng: argv mảng, env ALLOWLIST (6.2-1), timeout,
  giới hạn output, kill process group.
- Thành công chỉ khi mock trả status SUCCESS và hợp lệ schema; output không hợp lệ → FAILED (fail closed).
- Cancel: UPDATE ... WHERE status IN ('QUEUED','RUNNING') — không bị ghi đè thành DONE (6.2-5).
- Khởi động lại: run đang RUNNING → INTERRUPTED (theo STATE_MACHINES).
- Prompt/description không lưu plaintext trong agent_runs nếu không cần (6.2-7); log redact.
- UI: danh sách run theo task, chi tiết run, log đã redact. Hiển thị log dạng text thuần (không render HTML).

## Ngoài phạm vi
Worker thật, AGY, worktree tự động, P4-12 legacy adapter.

## Acceptance criteria
AC-1 Dispatch → run QUEUED → RUNNING → SUCCESS với mock thành công (integration test).
AC-2 Mock trả JSON sai schema → FAILED.
AC-3 Cancel trong lúc RUNNING và job hoàn tất cùng lúc → trạng thái cuối nhất quán, không bị DONE sau cancel.
AC-4 Hàng đợi vượt giới hạn → 429.
AC-5 Dispatch tới worker org khác → 403/404.
AC-6 Restart worker process → run RUNNING thành INTERRUPTED.
AC-7 Log/output trong DB và UI không chứa token/email giả đã cài vào output mock.
AC-8 Không có code path nào gọi binary agy/antigravity hay API provider (test grep/static).
```
