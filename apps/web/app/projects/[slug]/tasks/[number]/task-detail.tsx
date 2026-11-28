"use client";

import type { Task, TaskDependencies, TaskStatus } from "@aidevteam/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { sendJson } from "../../../../../lib/api-errors";

const LABELS: Record<TaskStatus, string> = {
  BACKLOG: "Backlog",
  TODO: "Cần làm",
  IN_PROGRESS: "Đang làm",
  IN_REVIEW: "Đang review",
  DONE: "Hoàn thành",
  CANCELLED: "Đã hủy",
};
const PRIORITY: Record<Task["priority"], string> = { low: "Thấp", medium: "Trung bình", high: "Cao" };

export function TaskDetailView({
  projectSlug,
  task,
  initialDeps,
  canWrite,
}: {
  projectSlug: string;
  task: Task;
  initialDeps: TaskDependencies;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [deps, setDeps] = useState<TaskDependencies>(initialDeps);
  const [error, setError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isBlocked = (deps.blockedBy?.length ?? 0) > 0;

  async function reloadDeps() {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/tasks/${task.number}/dependencies`);
      if (res.ok) {
        setDeps((await res.json()) as TaskDependencies);
      }
    } catch {
      // ignore
    }
  }

  async function removeDep(dependsOnNumber: number) {
    const r = await sendJson(
      "DELETE",
      `/api/projects/${encodeURIComponent(projectSlug)}/tasks/${task.number}/dependencies`,
      { dependsOn: dependsOnNumber },
    );
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    await reloadDeps();
    router.refresh();
  }

  async function onAddSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const dependsOn = Number(d.get("dependsOn") ?? "");
    if (!dependsOn || dependsOn <= 0) {
      setAddError("Vui lòng nhập số task.");
      return;
    }
    setLoading(true);
    setAddError(null);
    const r = await sendJson(
      "POST",
      `/api/projects/${encodeURIComponent(projectSlug)}/tasks/${task.number}/dependencies`,
      { dependsOn },
    );
    if (!r.ok) {
      setAddError(r.error);
      setLoading(false);
      return;
    }
    form.reset();
    setLoading(false);
    await reloadDeps();
    router.refresh();
  }

  return (
    <div>
      <div>
        <strong>Trạng thái:</strong> {LABELS[task.status]}{" "}
        {isBlocked ? (
          <span
            data-testid={`task-${task.number}-blocked`}
            style={{
              marginLeft: "0.5rem",
              padding: "0.1rem 0.35rem",
              backgroundColor: "#fee",
              color: "#c00",
              border: "1px solid #c00",
              borderRadius: "3px",
              fontSize: "0.85rem",
              fontWeight: "bold",
            }}
          >
            Bị chặn
          </span>
        ) : null}
      </div>
      <div>
        <strong>Ưu tiên:</strong> {PRIORITY[task.priority]}
      </div>
      {task.agentSlug ? (
        <div>
          <strong>Agent:</strong> {task.agentSlug}
        </div>
      ) : null}
      {task.description ? (
        <div style={{ marginTop: "0.5rem" }}>
          <strong>Mô tả:</strong>
          <p style={{ whiteSpace: "pre-wrap" }}>{task.description}</p>
        </div>
      ) : null}
      {task.cancelReason ? (
        <div>
          <strong>Lý do hủy:</strong> {task.cancelReason}
        </div>
      ) : null}
      <div style={{ marginTop: "0.5rem" }}>
        <Link href={`/projects/${encodeURIComponent(projectSlug)}/tasks/${task.number}/runs`}>Lịch sử chạy</Link>
      </div>

      <hr style={{ margin: "1rem 0" }} />

      <section aria-label="Phụ thuộc của task" data-testid="task-dependencies-section">
        <h2>Phụ thuộc ({deps.dependsOn?.length ?? 0})</h2>
        {error ? <p role="alert" style={{ color: "#c00" }}>{error}</p> : null}

        <div>
          <h3>Phụ thuộc vào:</h3>
          {(!deps.dependsOn || deps.dependsOn.length === 0) ? (
            <p>(Không có phụ thuộc)</p>
          ) : (
            <ul>
              {deps.dependsOn.map((dep) => (
                <li key={dep.number}>
                  #{dep.number} {dep.title} ({LABELS[dep.status]})
                  {canWrite ? (
                    <button
                      type="button"
                      style={{ marginLeft: "0.5rem" }}
                      onClick={() => removeDep(dep.number)}
                      aria-label={`Gỡ phụ thuộc #${dep.number}`}
                    >
                      Gỡ
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {isBlocked ? (
          <div>
            <h3 style={{ color: "#c00" }}>Bị chặn bởi:</h3>
            <ul>
              {deps.blockedBy.map((b) => (
                <li key={b.number} style={{ color: "#c00" }}>
                  #{b.number} {b.title} ({LABELS[b.status]})
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {deps.dependents && deps.dependents.length > 0 ? (
          <div>
            <h3>Task phụ thuộc vào task này:</h3>
            <ul>
              {deps.dependents.map((dep) => (
                <li key={dep.number}>
                  #{dep.number} {dep.title} ({LABELS[dep.status]})
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {canWrite && task.status !== "DONE" && task.status !== "CANCELLED" ? (
          <form onSubmit={onAddSubmit} aria-label={`Thêm phụ thuộc cho task #${task.number}`} style={{ marginTop: "1rem" }}>
            <label>
              Số task phụ thuộc:{" "}
              <input
                type="number"
                name="dependsOn"
                min={1}
                required
                aria-label="Số task phụ thuộc"
                style={{ width: "5rem" }}
              />
            </label>{" "}
            <button type="submit" disabled={loading}>
              Thêm phụ thuộc
            </button>
            {addError ? (
              <p role="alert" style={{ color: "#c00", margin: "0.25rem 0" }}>
                {addError}
              </p>
            ) : null}
          </form>
        ) : null}
      </section>
    </div>
  );
}
