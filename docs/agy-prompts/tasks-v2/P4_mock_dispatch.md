# P4-01 / P4-03 / P4-07 — Dispatch tới mock worker, vòng đời run, xem run/log

```text
TASK: P4-01+P4-03+P4-07 · Branch: ai/P4-01-mock-dispatch · 1 PR
Nguồn: STATE_MACHINES.md §2 (OWNER APPROVED), ADR-003 (job table PostgreSQL, ACCEPTED), CLAUDE.md §6.2, §9
Tham chiếu: tasks.controller.ts (transition có điều kiện), 0009_tasks.up.sql (trigger), workers.controller.ts,
            tasks.test.ts, tests/e2e/tasks.e2e.cjs, apps/api/src/app.module.ts (forRoot options)

LÀM
- Migration 0010_agent_runs (+down): agent_runs(id uuid, org_id, task_id, worker_id, status, attempt,
  queued_at, started_at, finished_at, output_summary ≤ 2000, log ≤ 65536, error_code, created_by_user_id).
  FK cùng org tới tasks và workers. status theo §2: QUEUED, RUNNING, SUCCEEDED, FAILED, CANCELLED, INTERRUPTED.
  Trigger chặn chuyển trạng thái ngoài §2 (mẫu 0009). Không lưu prompt/description của task (§6.2-7).
- Contracts run.ts: RUN_STATUSES, RUN_TRANSITIONS + test đọc bảng/sơ đồ §2 (mẫu task.test.ts);
  MockOutputSchema { status: "SUCCESS" | "FAILED", summary: string ≤ 2000 } — strict.
- API (permission dispatch:execute để ghi, run:read để đọc; org từ session):
  · POST /projects/:slug/tasks/:number/dispatch { workerSlug } → 201 run QUEUED.
    Worker phải cùng org, enabled, chưa lưu trữ, type mock; task ở TODO hoặc IN_PROGRESS (không tự đổi trạng thái task).
    Worker đang có run QUEUED/RUNNING → 409 worker_busy. Hàng đợi org > 20 run QUEUED → 429 (§6.2-8).
  · GET /projects/:slug/tasks/:number/runs · GET /runs/:id (uuid sai → 404; luôn lọc org_id).
  · POST /runs/:id/cancel → UPDATE … WHERE status IN ('QUEUED','RUNNING') (§6.2-5); 0 dòng → 409 run_not_cancellable.
- Mock runner trong api (không subprocess, không shell, không gọi mạng):
  · Lấy job: SELECT … FOR UPDATE SKIP LOCKED (đối chiếu tài liệu PostgreSQL 16 "SELECT … Locking Clause", ghi link).
  · QUEUED→RUNNING, sau đó SUCCEEDED/FAILED bằng UPDATE … WHERE status='RUNNING' (cancel thắng thì giữ CANCELLED).
  · Kết quả lấy từ hàm MockRunner inject được qua AppModule.forRoot({ mockRunner }) — test truyền kịch bản
    (thành công / output sai schema / ném lỗi / chậm). Mặc định production: SUCCESS, summary "mock run".
    KHÔNG suy kết quả từ nội dung task.
  · Thành công chỉ khi output parse được MockOutputSchema VÀ status=SUCCESS; còn lại FAILED (fail closed).
  · summary và log qua redact()/redactDeep() trước khi lưu.
  · Bật bằng env MOCK_WORKER_ENABLED=true (mặc định tắt trong test; test gọi hàm tick() trực tiếp).
  · Khởi động api: run RUNNING → INTERRUPTED (§6.2-6), ghi audit.
- Audit: run.dispatched / run.cancelled / run.finished (metadata: run id, task number, from/to; không có output).
- UI: trên thẻ Kanban nút "Chạy mock" (chọn worker) cho người có dispatch:execute; trang /runs/[id]
  hiện trạng thái, thời điểm, summary, log dạng <pre> text thuần; nút Hủy khi QUEUED/RUNNING.

AC
AC-1 Dispatch → QUEUED → RUNNING → SUCCEEDED với mock thành công.
AC-2 Mock trả output sai schema / ném lỗi → FAILED.
AC-3 Cancel đồng thời với lúc runner kết thúc → trạng thái cuối nhất quán; CANCELLED không bị ghi đè.
AC-4 >20 QUEUED trong org → 429; worker bận → 409.
AC-5 Worker/task/run của org khác → 404; viewer dispatch/cancel → 403.
AC-6 Khởi động lại → RUNNING thành INTERRUPTED.
AC-7 Token/email giả cài trong output mock không xuất hiện trong DB, API, UI.
AC-8 Test tĩnh: apps/api/src không import child_process và không chứa chuỗi "agy"/"antigravity".
AC-9 E2E tests/e2e/runs.e2e.cjs: chạy mock từ Kanban → xem run SUCCEEDED; log chứa HTML hiển thị dạng text.

NGOÀI PHẠM VI: worker thật, AGY, worktree, P4-12, retry tự động.
```
