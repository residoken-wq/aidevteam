"use client";

import type { Run, RunsResponse, RunStatus } from "@aidevteam/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { sendJson } from "../../lib/api-errors";
import { ConfirmDialog } from "../../lib/confirm-dialog";

const STATUS_LABELS: Record<RunStatus, string> = {
  QUEUED: "Chờ chạy (QUEUED)",
  RUNNING: "Đang chạy (RUNNING)",
  SUCCEEDED: "Thành công (SUCCEEDED)",
  FAILED: "Thất bại (FAILED)",
  CANCELLED: "Đã hủy (CANCELLED)",
  INTERRUPTED: "Gián đoạn (INTERRUPTED)",
};

export function RunsList({
  runsData,
  canCancel,
  initialFilters,
}: {
  runsData: RunsResponse | null;
  canCancel: boolean;
  initialFilters: {
    status: string;
    project: string;
    worker: string;
  };
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialFilters.status);
  const [project, setProject] = useState(initialFilters.project);
  const [worker, setWorker] = useState(initialFilters.worker);
  const [runToCancel, setRunToCancel] = useState<Run | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-refresh every 5s when there is any active (QUEUED or RUNNING) run; paused when tab hidden
  useEffect(() => {
    const hasActiveRun = runsData?.items.some((r) => r.status === "QUEUED" || r.status === "RUNNING");
    if (!hasActiveRun) return;

    const interval = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        router.refresh();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [runsData, router]);

  function handleFilterSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (project.trim()) params.set("project", project.trim());
    if (worker.trim()) params.set("worker", worker.trim());

    const qs = params.toString();
    router.push(`/runs${qs ? `?${qs}` : ""}`);
  }

  function handleClearFilter() {
    setStatus("");
    setProject("");
    setWorker("");
    router.push("/runs");
  }

  async function handleConfirmCancel() {
    if (!runToCancel) return;
    setCancelling(true);
    setError(null);

    const r = await sendJson("POST", `/api/runs/${encodeURIComponent(runToCancel.id)}/cancel`);
    if (!r.ok) {
      setError(r.error);
      setCancelling(false);
      setRunToCancel(null);
      return;
    }

    setCancelling(false);
    setRunToCancel(null);
    router.refresh();
  }

  const items = runsData?.items ?? [];
  const total = runsData?.total ?? 0;
  const limit = runsData?.limit ?? 50;
  const offset = runsData?.offset ?? 0;

  function handlePageChange(newOffset: number) {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (project.trim()) params.set("project", project.trim());
    if (worker.trim()) params.set("worker", worker.trim());
    params.set("limit", String(limit));
    params.set("offset", String(newOffset));
    router.push(`/runs?${params.toString()}`);
  }

  return (
    <div>
      <form
        onSubmit={handleFilterSubmit}
        aria-label="Bộ lọc lượt chạy"
        style={{
          display: "flex",
          gap: "0.5rem",
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: "1rem",
        }}
      >
        <label>
          Trạng thái:{" "}
          <select
            name="status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Lọc theo trạng thái"
          >
            <option value="">(Tất cả)</option>
            <option value="QUEUED">QUEUED — Chờ chạy</option>
            <option value="RUNNING">RUNNING — Đang chạy</option>
            <option value="SUCCEEDED">SUCCEEDED — Thành công</option>
            <option value="FAILED">FAILED — Thất bại</option>
            <option value="CANCELLED">CANCELLED — Đã hủy</option>
            <option value="INTERRUPTED">INTERRUPTED — Gián đoạn</option>
          </select>
        </label>

        <label>
          Dự án:{" "}
          <input
            type="text"
            name="project"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            placeholder="mã dự án (slug)"
            aria-label="Lọc theo dự án"
          />
        </label>

        <label>
          Worker:{" "}
          <input
            type="text"
            name="worker"
            value={worker}
            onChange={(e) => setWorker(e.target.value)}
            placeholder="mã worker (slug)"
            aria-label="Lọc theo worker"
          />
        </label>

        <button type="submit">Lọc</button>
        <button type="button" onClick={handleClearFilter}>
          Xóa lọc
        </button>
      </form>

      {error ? (
        <p role="alert" style={{ color: "#c00" }}>
          {error}
        </p>
      ) : null}

      <p aria-live="polite">
        Tổng số: <strong>{total}</strong> lượt chạy
        {total > 0
          ? ` (Hiển thị ${offset + 1}–${Math.min(offset + limit, total)})`
          : ""}
      </p>

      {items.length === 0 ? (
        <p>Không có lượt chạy nào phù hợp.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.5rem" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #ccc", textAlign: "left" }}>
              <th style={{ padding: "0.5rem" }}>Task</th>
              <th style={{ padding: "0.5rem" }}>Dự án</th>
              <th style={{ padding: "0.5rem" }}>Worker</th>
              <th style={{ padding: "0.5rem" }}>Trạng thái</th>
              <th style={{ padding: "0.5rem" }}>Lần thử</th>
              <th style={{ padding: "0.5rem" }}>Xếp hàng</th>
              <th style={{ padding: "0.5rem" }}>Bắt đầu</th>
              <th style={{ padding: "0.5rem" }}>Kết thúc</th>
              <th style={{ padding: "0.5rem" }}>Chi tiết</th>
              {canCancel ? <th style={{ padding: "0.5rem" }}>Thao tác</th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const isCancellable = canCancel && (r.status === "QUEUED" || r.status === "RUNNING");
              return (
                <tr
                  key={r.id}
                  data-testid={`run-row-${r.id}`}
                  style={{ borderBottom: "1px solid #eee" }}
                >
                  <td style={{ padding: "0.5rem" }}>
                    <Link href={`/projects/${encodeURIComponent(r.projectSlug)}/tasks/${r.taskNumber}`}>
                      Task #{r.taskNumber}
                    </Link>
                  </td>
                  <td style={{ padding: "0.5rem" }}>
                    <Link href={`/projects/${encodeURIComponent(r.projectSlug)}/tasks`}>
                      {r.projectSlug}
                    </Link>
                  </td>
                  <td style={{ padding: "0.5rem" }}>{r.workerSlug}</td>
                  <td style={{ padding: "0.5rem" }}>
                    <strong>{STATUS_LABELS[r.status] ?? r.status}</strong>
                  </td>
                  <td style={{ padding: "0.5rem" }}>#{r.attempt}</td>
                  <td style={{ padding: "0.5rem" }}>{r.queuedAt}</td>
                  <td style={{ padding: "0.5rem" }}>{r.startedAt ?? "—"}</td>
                  <td style={{ padding: "0.5rem" }}>{r.finishedAt ?? "—"}</td>
                  <td style={{ padding: "0.5rem" }}>
                    <Link href={`/runs/${r.id}`}>Chi tiết</Link>
                  </td>
                  {canCancel ? (
                    <td style={{ padding: "0.5rem" }}>
                      {isCancellable ? (
                        <button
                          type="button"
                          onClick={() => setRunToCancel(r)}
                          data-testid={`cancel-run-${r.id}`}
                        >
                          Hủy
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {total > limit ? (
        <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => handlePageChange(Math.max(0, offset - limit))}
          >
            ← Trang trước
          </button>
          <button
            type="button"
            disabled={offset + limit >= total}
            onClick={() => handlePageChange(offset + limit)}
          >
            Trang sau →
          </button>
        </div>
      ) : null}

      {runToCancel ? (
        <ConfirmDialog
          open={Boolean(runToCancel)}
          title="Xác nhận hủy lượt chạy"
          message={`Bạn có chắc chắn muốn hủy lượt chạy ${runToCancel.id} (Task #${runToCancel.taskNumber} — ${runToCancel.projectSlug})?`}
          confirmLabel="Xác nhận hủy"
          cancelLabel="Không"
          loading={cancelling}
          onConfirm={handleConfirmCancel}
          onCancel={() => setRunToCancel(null)}
        />
      ) : null}
    </div>
  );
}
