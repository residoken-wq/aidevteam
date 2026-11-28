"use client";

import {
  isAllowedTransition,
  TASK_STATUSES,
  TASK_TRANSITIONS,
  type Epic,
  type Sprint,
  type Task,
  type TaskDependencies,
  type TaskStatus,
} from "@aidevteam/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { sendJson } from "../../../../lib/api-errors";
import { ConfirmDialog } from "../../../../lib/confirm-dialog";
import {
  buildKanbanQuery,
  filterKanbanTasks,
  hasActiveKanbanFilters,
} from "../../../../lib/kanban-filter";
import {
  loadScrollPosition,
  saveScrollPosition,
  type ScrollPosition,
} from "../../../../lib/scroll-storage";
import { TaskDrawer } from "./task-drawer";

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
 * Kanban for one project (P3-04 / P3-04r).
 * Features:
 * - Server-enforced transitions & drag/drop
 * - Client-side filters for priority, agent, title search (q) combined with server epic/sprint
 * - Accessible task drawer (<dialog>) opened via card title button, URL synced (?task=n), Esc closes
 * - Scroll position preserved across router.refresh() and page reload (sessionStorage)
 * - Plain text rendering only (no raw HTML injection)
 */
export function Board({
  projectSlug,
  initial,
  initialDeps = {},
  canWrite,
  canDispatch = false,
  agents,
  workers = [],
  epics = [],
  sprints = [],
  currentEpic,
  currentSprint,
  currentPriority,
  currentAgent,
  currentQ,
  initialTaskNumber,
}: {
  projectSlug: string;
  initial: Task[];
  initialDeps?: Record<number, TaskDependencies>;
  canWrite: boolean;
  canDispatch?: boolean;
  agents: string[];
  workers?: Array<{ slug: string; name: string }>;
  epics?: Epic[];
  sprints?: Sprint[];
  currentEpic?: string;
  currentSprint?: string;
  currentPriority?: string;
  currentAgent?: string;
  currentQ?: string;
  initialTaskNumber?: number;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initial);
  const [deps, setDeps] = useState<Record<number, TaskDependencies>>(initialDeps);
  const [error, setError] = useState<string | null>(null);

  // Client-side filter states
  const [priorityFilter, setPriorityFilter] = useState(currentPriority ?? "");
  const [agentFilter, setAgentFilter] = useState(currentAgent ?? "");
  const [qFilter, setQFilter] = useState(currentQ ?? "");

  // Drawer state
  const [selectedTaskNumber, setSelectedTaskNumber] = useState<number | null>(initialTaskNumber ?? null);
  const taskButtonRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const lastFocusedBtnRef = useRef<HTMLButtonElement | null>(null);

  // Scroll preservation
  const boardRef = useRef<HTMLDivElement>(null);
  const preservedScrollRef = useRef<ScrollPosition | null>(null);

  function captureCurrentScroll(): ScrollPosition {
    return {
      scrollY: typeof window !== "undefined" ? window.scrollY : 0,
      scrollX: typeof window !== "undefined" ? window.scrollX : 0,
      boardScrollLeft: boardRef.current ? boardRef.current.scrollLeft : 0,
    };
  }

  function restoreScroll(pos: ScrollPosition) {
    if (typeof window === "undefined") return;
    window.scrollTo(pos.scrollX, pos.scrollY);
    if (boardRef.current) {
      boardRef.current.scrollLeft = pos.boardScrollLeft;
    }
  }

  function recordScrollForRefresh() {
    const pos = captureCurrentScroll();
    preservedScrollRef.current = pos;
    if (typeof window !== "undefined") {
      saveScrollPosition(projectSlug, window.location.search, pos);
    }
  }

  // Restore scroll on mount from sessionStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = loadScrollPosition(projectSlug, window.location.search);
    if (saved) {
      requestAnimationFrame(() => {
        restoreScroll(saved);
      });
    }
  }, [projectSlug]);

  // Listen to scroll events to persist position in sessionStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onScroll() {
      const pos = captureCurrentScroll();
      saveScrollPosition(projectSlug, window.location.search, pos);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    const boardEl = boardRef.current;
    if (boardEl) {
      boardEl.addEventListener("scroll", onScroll, { passive: true });
    }
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (boardEl) boardEl.removeEventListener("scroll", onScroll);
    };
  }, [projectSlug]);

  // Update tasks and restore scroll on initial prop update (e.g. router.refresh())
  useEffect(() => {
    setTasks(initial);
    if (preservedScrollRef.current) {
      const pos = preservedScrollRef.current;
      requestAnimationFrame(() => {
        restoreScroll(pos);
      });
    }
  }, [initial]);

  useEffect(() => setDeps(initialDeps), [initialDeps]);
  useEffect(() => setPriorityFilter(currentPriority ?? ""), [currentPriority]);
  useEffect(() => setAgentFilter(currentAgent ?? ""), [currentAgent]);
  useEffect(() => setQFilter(currentQ ?? ""), [currentQ]);

  // Open drawer if initialTaskNumber is specified
  useEffect(() => {
    if (initialTaskNumber) {
      setSelectedTaskNumber(initialTaskNumber);
    }
  }, [initialTaskNumber]);

  // Listen for browser Back/Forward (popstate) to sync drawer with ?task= parameter
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onPopState() {
      const sp = new URLSearchParams(window.location.search);
      const t = sp.get("task");
      if (t) {
        const num = parseInt(t, 10);
        if (Number.isInteger(num) && num > 0) {
          setSelectedTaskNumber(num);
          return;
        }
      }
      setSelectedTaskNumber(null);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function openDrawer(taskNumber: number) {
    lastFocusedBtnRef.current = taskButtonRefs.current[taskNumber] ?? null;
    setSelectedTaskNumber(taskNumber);
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      sp.set("task", String(taskNumber));
      window.history.pushState(null, "", `${window.location.pathname}?${sp.toString()}`);
    }
  }

  function closeDrawer() {
    setSelectedTaskNumber(null);
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      sp.delete("task");
      const qs = sp.toString();
      window.history.pushState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    }
    // Return focus to the trigger button
    lastFocusedBtnRef.current?.focus();
  }

  function onFilterSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const newEpic = String(d.get("epic") ?? "").trim();
    const newSprint = String(d.get("sprint") ?? "").trim();
    const newPriority = String(d.get("priority") ?? "").trim();
    const newAgent = String(d.get("agent") ?? "").trim();
    const newQ = String(d.get("q") ?? "").trim();

    setPriorityFilter(newPriority);
    setAgentFilter(newAgent);
    setQFilter(newQ);

    const query = buildKanbanQuery({
      epic: newEpic,
      sprint: newSprint,
      priority: newPriority,
      agent: newAgent,
      q: newQ,
      ...(selectedTaskNumber ? { task: selectedTaskNumber } : {}),
    });

    router.push(`/projects/${encodeURIComponent(projectSlug)}/tasks${query ? `?${query}` : ""}`);
  }

  async function reloadDeps(n: number) {
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectSlug)}/tasks/${n}/dependencies`);
      if (res.ok) {
        const data = (await res.json()) as TaskDependencies;
        setDeps((prev) => ({ ...prev, [n]: data }));
      }
    } catch {
      // ignore
    }
  }

  async function removeDep(taskNumber: number, dependsOnNumber: number) {
    recordScrollForRefresh();
    const r = await sendJson(
      "DELETE",
      `/api/projects/${encodeURIComponent(projectSlug)}/tasks/${taskNumber}/dependencies`,
      { dependsOn: dependsOnNumber },
    );
    if (!r.ok) {
      setError(r.error);
      return;
    }
    await reloadDeps(taskNumber);
    router.refresh();
  }

  async function move(task: Task, to: TaskStatus) {
    if (task.status === to) return;
    if (!isAllowedTransition(task.status, to)) {
      return setError(`Không thể chuyển từ "${LABELS[task.status]}" sang "${LABELS[to]}".`);
    }
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
    recordScrollForRefresh();
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

  // Filter tasks client-side
  const displayedTasks = filterKanbanTasks(tasks, {
    priority: priorityFilter,
    agent: agentFilter,
    q: qFilter,
  });

  const isFiltered = hasActiveKanbanFilters({
    epic: currentEpic,
    sprint: currentSprint,
    priority: priorityFilter,
    agent: agentFilter,
    q: qFilter,
  });

  // Collect all known agent slugs for filter options
  const allAgentOptions = Array.from(
    new Set([...agents, ...(tasks.map((t) => t.agentSlug).filter(Boolean) as string[])]),
  ).sort();

  const activeDrawerTask = tasks.find((t) => t.number === selectedTaskNumber) ?? null;

  return (
    <>
      <form
        method="get"
        aria-label="Bộ lọc task"
        onSubmit={onFilterSubmit}
        style={{ marginBottom: "1rem", display: "flex", gap: "1rem", alignItems: "center", flexWrap: "wrap" }}
      >
        <label>
          Epic:{" "}
          <select name="epic" defaultValue={currentEpic ?? ""}>
            <option value="">Tất cả epic</option>
            {epics.map((e) => (
              <option key={e.slug} value={e.slug}>
                {e.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sprint:{" "}
          <select name="sprint" defaultValue={currentSprint ?? ""}>
            <option value="">Tất cả sprint</option>
            {sprints.map((s) => (
              <option key={s.number} value={String(s.number)}>
                Sprint #{s.number} — {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Ưu tiên:{" "}
          <select name="priority" defaultValue={currentPriority ?? ""}>
            <option value="">Tất cả ưu tiên</option>
            <option value="low">Thấp</option>
            <option value="medium">Trung bình</option>
            <option value="high">Cao</option>
          </select>
        </label>
        <label>
          Agent:{" "}
          <select name="agent" defaultValue={currentAgent ?? ""}>
            <option value="">Tất cả agent</option>
            <option value="unassigned">Chưa gán</option>
            {allAgentOptions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tìm:{" "}
          <input
            type="text"
            name="q"
            defaultValue={currentQ ?? ""}
            placeholder="Tìm theo tiêu đề..."
            aria-label="Tìm theo tiêu đề"
          />
        </label>
        <button type="submit">Lọc</button>
        {isFiltered ? (
          <Link href={`/projects/${encodeURIComponent(projectSlug)}/tasks`}>Xóa lọc</Link>
        ) : null}
      </form>

      {canWrite ? (
        <CreateTaskForm
          projectSlug={projectSlug}
          agents={agents}
          epics={epics}
          sprints={sprints}
          onBeforeRefresh={recordScrollForRefresh}
        />
      ) : null}
      {error ? <p role="alert">{error}</p> : null}

      <div
        ref={boardRef}
        data-testid="kanban-board-container"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${TASK_STATUSES.length}, minmax(10rem, 1fr))`,
          gap: "0.5rem",
          overflowX: "auto",
        }}
      >
        {TASK_STATUSES.map((status) => {
          const items = displayedTasks.filter((t) => t.status === status);
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
              {items.map((t) => {
                const taskDeps = deps[t.number];
                const isBlocked = (taskDeps?.blockedBy?.length ?? 0) > 0;
                return (
                  <article
                    key={t.number}
                    data-testid={`task-${t.number}`}
                    draggable={canWrite && TASK_TRANSITIONS[t.status].length > 0}
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", String(t.number))}
                    style={{ border: "1px solid #999", padding: "0.25rem", marginBottom: "0.5rem", background: "#fff" }}
                  >
                    <strong>
                      <button
                        type="button"
                        data-testid={`task-${t.number}-title-btn`}
                        onClick={() => openDrawer(t.number)}
                        aria-haspopup="dialog"
                        aria-label={`Chi tiết task #${t.number}: ${t.title}`}
                        ref={(el) => {
                          taskButtonRefs.current[t.number] = el;
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          padding: 0,
                          font: "inherit",
                          fontWeight: "bold",
                          textAlign: "left",
                          cursor: "pointer",
                          textDecoration: "underline",
                          color: "inherit",
                          display: "inline",
                        }}
                      >
                        #{t.number} {t.title}
                      </button>
                    </strong>
                    {isBlocked ? (
                      <span
                        data-testid={`task-${t.number}-blocked`}
                        style={{
                          marginLeft: "0.5rem",
                          padding: "0.1rem 0.35rem",
                          backgroundColor: "#fee",
                          color: "#c00",
                          border: "1px solid #c00",
                          borderRadius: "3px",
                          fontSize: "0.75rem",
                          fontWeight: "bold",
                        }}
                      >
                        Bị chặn
                      </span>
                    ) : null}
                    {t.epicSlug || (t.sprintNumber !== null && t.sprintNumber !== undefined) ? (
                      <div style={{ marginTop: "0.25rem", display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                        {t.epicSlug ? (
                          <span
                            data-testid={`badge-epic-${t.number}`}
                            style={{
                              fontSize: "0.75rem",
                              padding: "0.1rem 0.35rem",
                              borderRadius: "3px",
                              background: "#e0f2fe",
                              color: "#0369a1",
                              border: "1px solid #bae6fd",
                            }}
                          >
                            Epic: {epics.find((e) => e.slug === t.epicSlug)?.title ?? t.epicSlug}
                          </span>
                        ) : null}
                        {t.sprintNumber !== null && t.sprintNumber !== undefined ? (
                          <span
                            data-testid={`badge-sprint-${t.number}`}
                            style={{
                              fontSize: "0.75rem",
                              padding: "0.1rem 0.35rem",
                              borderRadius: "3px",
                              background: "#fef3c7",
                              color: "#b45309",
                              border: "1px solid #fde68a",
                            }}
                          >
                            Sprint #{t.sprintNumber}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <div>
                      <small>
                        Ưu tiên: {PRIORITY[t.priority]}
                        {t.agentSlug ? ` · Agent: ${t.agentSlug}` : ""}
                      </small>
                    </div>
                    {t.requiredCapabilities && t.requiredCapabilities.length > 0 ? (
                      <div>
                        <small>Yêu cầu: {t.requiredCapabilities.join(", ")}</small>
                      </div>
                    ) : null}
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
                    <details style={{ marginTop: "0.25rem", marginBottom: "0.25rem" }} data-testid={`task-${t.number}-deps`}>
                      <summary>Phụ thuộc ({taskDeps?.dependsOn?.length ?? 0})</summary>
                      <div style={{ padding: "0.25rem", backgroundColor: "#f9f9f9", marginTop: "0.25rem", border: "1px solid #eee" }}>
                        <div>
                          <small><strong>Phụ thuộc vào:</strong></small>
                          {(!taskDeps?.dependsOn || taskDeps.dependsOn.length === 0) ? (
                            <div><small>(Không có)</small></div>
                          ) : (
                            <ul style={{ margin: "0.25rem 0", paddingLeft: "1.2rem", fontSize: "0.85rem" }}>
                              {taskDeps.dependsOn.map((dep) => (
                                <li key={dep.number}>
                                  #{dep.number} {dep.title} ({LABELS[dep.status]})
                                  {canWrite ? (
                                    <button
                                      type="button"
                                      style={{ marginLeft: "0.5rem", fontSize: "0.75rem" }}
                                      onClick={() => removeDep(t.number, dep.number)}
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
                          <div style={{ marginTop: "0.25rem" }}>
                            <small style={{ color: "#c00" }}>
                              <strong>Bị chặn bởi:</strong>{" "}
                              {(taskDeps?.blockedBy ?? []).map((b) => `#${b.number} (${LABELS[b.status]})`).join(", ")}
                            </small>
                          </div>
                        ) : null}

                        {taskDeps?.dependents && taskDeps.dependents.length > 0 ? (
                          <div style={{ marginTop: "0.25rem" }}>
                            <small><strong>Task phụ thuộc vào task này:</strong></small>
                            <ul style={{ margin: "0.25rem 0", paddingLeft: "1.2rem", fontSize: "0.85rem" }}>
                              {taskDeps.dependents.map((dep) => (
                                <li key={dep.number}>
                                  #{dep.number} {dep.title} ({LABELS[dep.status]})
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {canWrite && t.status !== "DONE" && t.status !== "CANCELLED" ? (
                          <AddDependencyForm
                            projectSlug={projectSlug}
                            taskNumber={t.number}
                            onBeforeRefresh={recordScrollForRefresh}
                            onAdded={async () => {
                              await reloadDeps(t.number);
                              router.refresh();
                            }}
                          />
                        ) : null}
                      </div>
                    </details>
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
                );
              })}
            </section>
          );
        })}
      </div>

      <TaskDrawer
        open={selectedTaskNumber !== null}
        task={activeDrawerTask}
        projectSlug={projectSlug}
        deps={selectedTaskNumber ? deps[selectedTaskNumber] : undefined}
        epics={epics}
        sprints={sprints}
        onClose={closeDrawer}
      />
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

function CreateTaskForm({
  projectSlug,
  agents,
  epics = [],
  sprints = [],
  onBeforeRefresh,
}: {
  projectSlug: string;
  agents: string[];
  epics?: Epic[];
  sprints?: Sprint[];
  onBeforeRefresh?: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const description = String(d.get("description") ?? "");
    const agentSlug = String(d.get("agentSlug") ?? "");
    const epicSlug = String(d.get("epicSlug") ?? "");
    const sprintNumberStr = String(d.get("sprintNumber") ?? "");
    const sprintNumber = sprintNumberStr ? Number(sprintNumberStr) : undefined;
    const reqCapsRaw = String(d.get("requiredCapabilities") ?? "");
    const requiredCapabilities = reqCapsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const r = await sendJson("POST", `/api/projects/${encodeURIComponent(projectSlug)}/tasks`, {
      title: String(d.get("title") ?? ""),
      priority: String(d.get("priority") ?? "medium"),
      ...(description ? { description } : {}),
      ...(agentSlug ? { agentSlug } : {}),
      ...(epicSlug ? { epicSlug } : {}),
      ...(sprintNumber !== undefined ? { sprintNumber } : {}),
      ...(requiredCapabilities.length > 0 ? { requiredCapabilities } : {}),
    });
    if (!r.ok) return setError(r.error);
    setError(null);
    form.reset();
    onBeforeRefresh?.();
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
      </label>{" "}
      <label>
        Epic{" "}
        <select name="epicSlug" defaultValue="">
          <option value="">(không có)</option>
          {epics
            .filter((e) => !e.archivedAt)
            .map((e) => (
              <option key={e.slug} value={e.slug}>
                {e.title}
              </option>
            ))}
        </select>
      </label>{" "}
      <label>
        Sprint{" "}
        <select name="sprintNumber" defaultValue="">
          <option value="">(không có)</option>
          {sprints
            .filter((s) => s.status !== "CLOSED")
            .map((s) => (
              <option key={s.number} value={s.number}>
                Sprint #{s.number} — {s.name}
              </option>
            ))}
        </select>
      </label>{" "}
      <label>
        Năng lực yêu cầu (cách nhau bởi dấu phẩy) <input name="requiredCapabilities" placeholder="backend, nodejs" />
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
  const [selectedWorkerSlug, setSelectedWorkerSlug] = useState(workers[0]?.slug ?? "");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedWorkerSlug) {
      setError("Vui lòng chọn worker mock.");
      return;
    }
    setError(null);
    setConfirmOpen(true);
  }

  async function handleConfirmDispatch() {
    setLoading(true);
    setError(null);
    const r = await sendJson<{ id: string }>(
      "POST",
      `/api/projects/${encodeURIComponent(projectSlug)}/tasks/${taskNumber}/dispatch`,
      { workerSlug: selectedWorkerSlug },
    );
    if (!r.ok) {
      setError(r.error);
      setLoading(false);
      setConfirmOpen(false);
      return;
    }
    setConfirmOpen(false);
    router.push(`/runs/${r.data.id}`);
  }

  const selectedWorker = workers.find((w) => w.slug === selectedWorkerSlug);

  return (
    <>
      <form onSubmit={onSubmit} aria-label={`Chạy mock task #${taskNumber}`} style={{ marginTop: "0.25rem" }}>
        <select
          name="workerSlug"
          value={selectedWorkerSlug}
          onChange={(e) => setSelectedWorkerSlug(e.target.value)}
          aria-label="Worker"
          required
        >
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

      <ConfirmDialog
        open={confirmOpen}
        title="Xác nhận chạy mock"
        message={`Bạn có chắc chắn muốn chạy mock task #${taskNumber} với worker "${selectedWorker?.name ?? selectedWorkerSlug}"?`}
        confirmLabel="Xác nhận"
        cancelLabel="Không"
        loading={loading}
        onConfirm={handleConfirmDispatch}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

function AddDependencyForm({
  projectSlug,
  taskNumber,
  onAdded,
  onBeforeRefresh,
}: {
  projectSlug: string;
  taskNumber: number;
  onAdded: () => Promise<void>;
  onBeforeRefresh?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const dependsOn = Number(d.get("dependsOn") ?? "");
    if (!dependsOn || dependsOn <= 0) {
      setError("Vui lòng nhập số task.");
      return;
    }
    setLoading(true);
    setError(null);
    const r = await sendJson(
      "POST",
      `/api/projects/${encodeURIComponent(projectSlug)}/tasks/${taskNumber}/dependencies`,
      { dependsOn },
    );
    if (!r.ok) {
      setError(r.error);
      setLoading(false);
      return;
    }
    form.reset();
    setLoading(false);
    onBeforeRefresh?.();
    await onAdded();
  }

  return (
    <form onSubmit={onSubmit} aria-label={`Thêm phụ thuộc cho task #${taskNumber}`} style={{ marginTop: "0.5rem" }}>
      <label>
        Số task phụ thuộc:{" "}
        <input
          type="number"
          name="dependsOn"
          min={1}
          required
          aria-label="Số task phụ thuộc"
          style={{ width: "4rem" }}
        />
      </label>{" "}
      <button type="submit" disabled={loading}>
        Thêm phụ thuộc
      </button>
      {error ? (
        <p role="alert" style={{ color: "#c00", margin: "0.25rem 0", fontSize: "0.85rem" }}>
          {error}
        </p>
      ) : null}
    </form>
  );
}
