"use client";

import { isAllowedTransition, TASK_STATUSES, TASK_TRANSITIONS, type Task, type TaskStatus } from "@aidevteam/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type DragEvent, type FormEvent } from "react";
import { sendJson } from "../../../../lib/api-errors";

const LABELS: Record<TaskStatus, string> = {
  BACKLOG: "Backlog",
  TODO: "Cần làm",
  IN_PROGRESS: "Đang làm",
  IN_REVIEW: "Đang review",
  DONE: "Hoàn thành",
  CANCELLED: "Đã hủy",
};
const PRIORITY: Record<Task["priority"], string> = { low: "Thấp", medium: "Trung bình", high: "Cao" };

/**
 * Kanban for one project (P3-04). Every move calls POST …/transitions with expectedFrom = the card's status as shown;
 * a refused move is rolled back on screen with a message. Task text is rendered as plain text only (no HTML).
 */
export function Board({
  projectSlug,
  initial,
  canWrite,
  canDispatch = false,
  agents,
  workers = [],
}: {
  projectSlug: string;
  initial: Task[];
  canWrite: boolean;
  canDispatch?: boolean;
  agents: string[];
  workers?: Array<{ slug: string; name: string }>;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setTasks(initial), [initial]);

  async function move(task: Task, to: TaskStatus) {
    if (task.status === to) return;
    if (!isAllowedTransition(task.status, to)) return setError(`Không thể chuyển từ "${LABELS[task.status]}" sang "${LABELS[to]}".`);
    const body: Record<string, unknown> = { expectedFrom: task.status, to };
    if (to === "DONE") {
      if (!window.confirm(`Xác nhận task #${task.number} đã đạt acceptance criteria, có test và đã được người review?`)) return;
      body.confirmReviewed = true;
    }
    if (to === "CANCELLED") {
      const reason = window.prompt(`Lý do hủy task #${task.number}:`)?.trim();
      if (!reason) return setError("Cần nhập lý do để hủy task.");
      body.reason = reason;
    }
    const before = tasks;
    setTasks(tasks.map((t) => (t.number === task.number ? { ...t, status: to } : t))); // optimistic
    const r = await sendJson("POST", `/api/projects/${encodeURIComponent(projectSlug)}/tasks/${task.number}/transitions`, body);
    if (!r.ok) {
      setTasks(before); // roll back on screen
      setError(r.error);
      router.refresh(); // pick up the real state (e.g. someone else moved it)
      return;
    }
    setError(null);
    router.refresh();
  }

  function onDrop(e: DragEvent<HTMLElement>, to: TaskStatus) {
    e.preventDefault();
    const n = Number(e.dataTransfer.getData("text/plain"));
    const task = tasks.find((t) => t.number === n);
    if (task) void move(task, to);
  }

  return (
    <>
      {canWrite ? <CreateTaskForm projectSlug={projectSlug} agents={agents} /> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${TASK_STATUSES.length}, minmax(10rem, 1fr))`, gap: "0.5rem", overflowX: "auto" }}>
        {TASK_STATUSES.map((status) => {
          const items = tasks.filter((t) => t.status === status);
          // Always accept drops when the user may write: gating on a "dragging" state attached the handlers only after
          // a re-render, so a fast drag-and-drop was silently ignored. Unknown payloads match no task and do nothing.
          const droppable = canWrite;
          return (
            <section
              key={status}
              aria-label={LABELS[status]}
              data-testid={`col-${status}`}
              onDragOver={droppable ? (e) => e.preventDefault() : undefined}
              onDrop={droppable ? (e) => onDrop(e, status) : undefined}
              style={{ border: "1px solid #ccc", padding: "0.5rem", minHeight: "8rem" }}
            >
              <h2 style={{ fontSize: "1rem" }}>
                {LABELS[status]} ({items.length})
              </h2>
              {items.map((t) => (
                <article
                  key={t.number}
                  data-testid={`task-${t.number}`}
                  draggable={canWrite && TASK_TRANSITIONS[t.status].length > 0}
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", String(t.number))}
                  style={{ border: "1px solid #999", padding: "0.25rem", marginBottom: "0.5rem", background: "#fff" }}
                >
                  <strong>
                    #{t.number} {t.title}
                  </strong>
                  <div>
                    <small>
                      Ưu tiên: {PRIORITY[t.priority]}
                      {t.agentSlug ? ` · Agent: ${t.agentSlug}` : ""}
                    </small>
                  </div>
                  {t.description ? (
                    <details>
                      <summary>Mô tả</summary>
                      <p style={{ whiteSpace: "pre-wrap" }}>{t.description}</p>
                    </details>
                  ) : null}
                  {t.cancelReason ? (
                    <div>
                      <small>Lý do hủy: {t.cancelReason}</small>
                    </div>
                  ) : null}
                  <div>
                    <small>
                      <Link href={`/projects/${encodeURIComponent(projectSlug)}/tasks/${t.number}/runs`}>Lịch sử chạy</Link>
                    </small>
                  </div>
                  {canWrite && TASK_TRANSITIONS[t.status].length > 0 ? <MoveControl task={t} onMove={move} /> : null}
                  {canDispatch && (t.status === "TODO" || t.status === "IN_PROGRESS") ? (
                    <DispatchMockForm projectSlug={projectSlug} taskNumber={t.number} workers={workers} />
                  ) : null}
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}

/** Keyboard/screen-reader alternative to drag and drop: only the allowed next states are offered. */
function MoveControl({ task, onMove }: { task: Task; onMove: (t: Task, to: TaskStatus) => Promise<void> }) {
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const to = String(new FormData(e.currentTarget).get("to") ?? "") as TaskStatus;
    if (to) void onMove(task, to);
  }
  return (
    <form onSubmit={submit} aria-label={`Chuyển task #${task.number}`}>
      <select name="to" defaultValue="" aria-label="Chuyển sang">
        <option value="" disabled>
          Chuyển sang…
        </option>
        {TASK_TRANSITIONS[task.status].map((s) => (
          <option key={s} value={s}>
            {LABELS[s]}
          </option>
        ))}
      </select>{" "}
      <button type="submit">Chuyển</button>
    </form>
  );
}

function CreateTaskForm({ projectSlug, agents }: { projectSlug: string; agents: string[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const description = String(d.get("description") ?? "");
    const agentSlug = String(d.get("agentSlug") ?? "");
    const r = await sendJson("POST", `/api/projects/${encodeURIComponent(projectSlug)}/tasks`, {
      title: String(d.get("title") ?? ""),
      priority: String(d.get("priority") ?? "medium"),
      ...(description ? { description } : {}),
      ...(agentSlug ? { agentSlug } : {}),
    });
    if (!r.ok) return setError(r.error);
    setError(null);
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} aria-label="Tạo task">
      <label>
        Tiêu đề <input name="title" required maxLength={200} />
      </label>{" "}
      <label>
        Ưu tiên{" "}
        <select name="priority" defaultValue="medium">
          {Object.entries(PRIORITY).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </label>{" "}
      <label>
        Agent{" "}
        <select name="agentSlug" defaultValue="">
          <option value="">(chưa giao)</option>
          {agents.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <br />
      <label>
        Mô tả <textarea name="description" maxLength={10000} rows={3} cols={60} />
      </label>{" "}
      <button type="submit">Tạo task</button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

function DispatchMockForm({
  projectSlug,
  taskNumber,
  workers,
}: {
  projectSlug: string;
  taskNumber: number;
  workers: Array<{ slug: string; name: string }>;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    const workerSlug = String(d.get("workerSlug") ?? "");
    if (!workerSlug) {
      setError("Vui lòng chọn worker mock.");
      return;
    }
    setLoading(true);
    setError(null);
    const r = await sendJson<{ id: string }>(
      "POST",
      `/api/projects/${encodeURIComponent(projectSlug)}/tasks/${taskNumber}/dispatch`,
      { workerSlug },
    );
    if (!r.ok) {
      setError(r.error);
      setLoading(false);
      return;
    }
    router.push(`/runs/${r.data.id}`);
  }

  return (
    <form onSubmit={onSubmit} aria-label={`Chạy mock task #${taskNumber}`} style={{ marginTop: "0.25rem" }}>
      <select name="workerSlug" defaultValue={workers[0]?.slug ?? ""} aria-label="Worker" required>
        {workers.length === 0 ? (
          <option value="" disabled>
            (không có worker mock)
          </option>
        ) : (
          workers.map((w) => (
            <option key={w.slug} value={w.slug}>
              {w.name}
            </option>
          ))
        )}
      </select>{" "}
      <button type="submit" disabled={loading || workers.length === 0}>
        Chạy mock
      </button>
      {error ? (
        <p role="alert" style={{ color: "#c00", margin: "0.25rem 0" }}>
          {error}
        </p>
      ) : null}
    </form>
  );
}
