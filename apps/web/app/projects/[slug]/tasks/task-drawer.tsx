"use client";

import type { Epic, Sprint, Task, TaskActivityResponse, TaskDependencies, TaskStatus } from "@aidevteam/contracts";
import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

const STATUS_LABELS: Record<TaskStatus, string> = {
  BACKLOG: "Backlog",
  TODO: "Cần làm",
  IN_PROGRESS: "Đang làm",
  IN_REVIEW: "Đang review",
  DONE: "Hoàn thành",
  CANCELLED: "Đã hủy",
};

const PRIORITY_LABELS: Record<Task["priority"], string> = {
  low: "Thấp",
  medium: "Trung bình",
  high: "Cao",
};

const ACTION_LABELS: Record<string, string> = {
  "task.created": "Tạo task",
  "task.updated": "Cập nhật task",
  "task.transitioned": "Chuyển trạng thái",
  "task.dependency_added": "Thêm phụ thuộc",
  "task.dependency_removed": "Gỡ phụ thuộc",
  "task.commented": "Bình luận",
};

function formatAction(action: string | undefined): string {
  if (!action) return "Hoạt động";
  return ACTION_LABELS[action] ?? action;
}

function formatDetails(details: Record<string, unknown> | undefined): string {
  if (!details || Object.keys(details).length === 0) return "";
  const parts: string[] = [];
  if (details.from && details.to) parts.push(`${details.from} → ${details.to}`);
  else if (details.to) parts.push(`sang ${details.to}`);
  if (details.fields) parts.push(`trường: ${details.fields}`);
  if (details.reason) parts.push(`lý do: ${details.reason}`);
  if (details.dependsOn) parts.push(`phụ thuộc #${details.dependsOn}`);
  if (details.number && !details.dependsOn) parts.push(`#${details.number}`);
  if (details.length) parts.push(`độ dài: ${details.length}`);
  if (parts.length === 0) {
    return Object.entries(details)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(", ");
  }
  return parts.join("; ");
}

export interface TaskDrawerProps {
  open: boolean;
  task: Task | null;
  projectSlug: string;
  deps?: TaskDependencies;
  epics?: Epic[];
  sprints?: Sprint[];
  onClose: () => void;
}

/**
 * Task detail drawer (P3-04 AC-2).
 * Rendered as an accessible modal dialog on the right side.
 * Esc closes and returns focus to the opener button.
 * All user text is rendered as plain text (no raw HTML injection).
 */
export function TaskDrawer({
  open,
  task,
  projectSlug,
  deps,
  epics = [],
  sprints = [],
  onClose,
}: TaskDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [activityData, setActivityData] = useState<TaskActivityResponse | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string | null>(null);

  // Manage native dialog open/close and focus
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && task) {
      if (!dialog.open) {
        dialog.showModal();
      }
      closeBtnRef.current?.focus();
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [open, task]);

  // Fetch 5 latest activities when opened
  useEffect(() => {
    if (!open || !task) {
      setActivityData(null);
      setActivityError(null);
      return;
    }

    let active = true;
    setActivityLoading(true);
    setActivityError(null);

    fetch(`/api/projects/${encodeURIComponent(projectSlug)}/tasks/${task.number}/activity?limit=5`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Không thể tải lịch sử hoạt động");
        const data = (await res.json()) as TaskActivityResponse;
        if (active) {
          setActivityData(data);
          setActivityLoading(false);
        }
      })
      .catch((err: Error) => {
        if (active) {
          setActivityError(err.message);
          setActivityLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [open, task?.number, projectSlug]);

  function handleKeyDown(e: KeyboardEvent<HTMLDialogElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  }

  if (!open || !task) return null;

  const epic = epics.find((e) => e.slug === task.epicSlug);
  const sprint = sprints.find((s) => s.number === task.sprintNumber);
  const isBlocked = (deps?.blockedBy?.length ?? 0) > 0;
  const activities = (activityData?.items ?? []).slice(0, 5);

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-task-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={handleKeyDown}
      data-testid="task-drawer"
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: "480px",
        maxWidth: "92vw",
        height: "100vh",
        maxHeight: "100vh",
        margin: "0 0 0 auto",
        padding: "1.5rem",
        border: "none",
        borderLeft: "1px solid #ccc",
        background: "#fff",
        boxShadow: "-4px 0 20px rgba(0, 0, 0, 0.15)",
        overflowY: "auto",
        zIndex: 1000,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
        <h2 id="drawer-task-title" data-testid="drawer-task-title" style={{ margin: 0, fontSize: "1.25rem" }}>
          #{task.number} {task.title}
        </h2>
        <button
          ref={closeBtnRef}
          type="button"
          onClick={onClose}
          aria-label="Đóng ngăn chi tiết"
          data-testid="drawer-close-btn"
          style={{
            cursor: "pointer",
            background: "#eee",
            border: "1px solid #ccc",
            borderRadius: "4px",
            padding: "0.25rem 0.5rem",
            fontSize: "0.85rem",
          }}
        >
          Đóng (Esc)
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", fontSize: "0.95rem" }}>
        <div data-testid="drawer-task-status">
          <strong>Trạng thái:</strong> {STATUS_LABELS[task.status]}
          {isBlocked ? (
            <span
              data-testid="drawer-blocked-badge"
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
        </div>

        <div data-testid="drawer-task-priority">
          <strong>Ưu tiên:</strong> {PRIORITY_LABELS[task.priority]}
        </div>

        <div data-testid="drawer-task-agent">
          <strong>Agent:</strong> {task.agentSlug ? task.agentSlug : "Chưa gán"}
        </div>

        <div data-testid="drawer-task-epic-sprint">
          <strong>Epic / Sprint:</strong>{" "}
          {epic ? `Epic: ${epic.title}` : task.epicSlug ? `Epic: ${task.epicSlug}` : "(không có epic)"}
          {" · "}
          {sprint
            ? `Sprint #${sprint.number} — ${sprint.name}`
            : task.sprintNumber !== null && task.sprintNumber !== undefined
              ? `Sprint #${task.sprintNumber}`
              : "(không có sprint)"}
        </div>

        <div data-testid="drawer-task-capabilities">
          <strong>Yêu cầu năng lực:</strong>{" "}
          {task.requiredCapabilities && task.requiredCapabilities.length > 0
            ? task.requiredCapabilities.join(", ")
            : "(không có)"}
        </div>

        <div>
          <strong>Mô tả:</strong>
          <p
            data-testid="drawer-task-description"
            style={{
              margin: "0.25rem 0 0",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              backgroundColor: "#f9f9f9",
              padding: "0.5rem",
              borderRadius: "4px",
              border: "1px solid #eee",
            }}
          >
            {task.description ? task.description : "(không có mô tả)"}
          </p>
        </div>

        {task.cancelReason ? (
          <div data-testid="drawer-task-cancel-reason">
            <strong>Lý do hủy:</strong> {task.cancelReason}
          </div>
        ) : null}

        <div data-testid="drawer-task-deps">
          <strong>Phụ thuộc (đang chặn):</strong>
          {isBlocked ? (
            <ul data-testid="drawer-blocked-by-list" style={{ color: "#c00", margin: "0.25rem 0", paddingLeft: "1.2rem" }}>
              {deps?.blockedBy.map((b) => (
                <li key={b.number}>
                  #{b.number} {b.title} ({STATUS_LABELS[b.status]})
                </li>
              ))}
            </ul>
          ) : (
            <span> (không có task nào đang chặn)</span>
          )}

          {deps?.dependsOn && deps.dependsOn.length > 0 ? (
            <div style={{ marginTop: "0.35rem" }}>
              <small>
                <strong>Tất cả phụ thuộc ({deps.dependsOn.length}):</strong>
              </small>
              <ul style={{ margin: "0.25rem 0", paddingLeft: "1.2rem", fontSize: "0.85rem" }}>
                {deps.dependsOn.map((d) => (
                  <li key={d.number}>
                    #{d.number} {d.title} ({STATUS_LABELS[d.status]})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <section aria-label="Hoạt động gần nhất" data-testid="drawer-task-activity" style={{ marginTop: "0.5rem" }}>
          <h3 style={{ fontSize: "1rem", margin: "0 0 0.5rem" }}>5 hoạt động gần nhất</h3>
          {activityLoading ? (
            <p style={{ fontSize: "0.85rem", color: "#666" }}>Đang tải hoạt động...</p>
          ) : activityError ? (
            <p role="alert" style={{ color: "#c00", fontSize: "0.85rem" }}>
              {activityError}
            </p>
          ) : activities.length === 0 ? (
            <p style={{ fontSize: "0.85rem", color: "#666" }}>(Chưa có hoạt động)</p>
          ) : (
            <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
              {activities.map((item, idx) => {
                const author = item.actorLogin
                  ? `@${item.actorLogin}`
                  : item.actorGithubUserId
                    ? `#${item.actorGithubUserId}`
                    : "Hệ thống";
                const dateStr = new Date(item.at).toLocaleString("vi-VN");
                return (
                  <li
                    key={`${item.kind}-${item.at}-${idx}`}
                    data-testid={`drawer-activity-item-${idx}`}
                    style={{
                      marginBottom: "0.5rem",
                      padding: "0.5rem",
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                      backgroundColor: item.kind === "comment" ? "#fbfbfb" : "#f5f5f5",
                      fontSize: "0.85rem",
                    }}
                  >
                    <div style={{ color: "#666", marginBottom: "0.2rem" }}>
                      <strong>{author}</strong>{" "}
                      {item.kind === "comment" ? "đã bình luận" : formatAction(item.action)}{" "}
                      vào <time dateTime={item.at}>{dateStr}</time>
                    </div>
                    {item.kind === "comment" ? (
                      <p style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{item.body}</p>
                    ) : item.details && Object.keys(item.details).length > 0 ? (
                      <div>{formatDetails(item.details)}</div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <nav
          aria-label="Liên kết nhanh của task"
          data-testid="drawer-task-links"
          style={{
            marginTop: "1rem",
            paddingTop: "1rem",
            borderTop: "1px solid #eee",
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
            fontSize: "0.9rem",
          }}
        >
          <Link href={`/projects/${encodeURIComponent(projectSlug)}/tasks/${task.number}`}>
            Mở trang chi tiết
          </Link>
          <Link href={`/projects/${encodeURIComponent(projectSlug)}/tasks/${task.number}/contract`}>
            Hợp đồng task
          </Link>
          <Link href={`/projects/${encodeURIComponent(projectSlug)}/tasks/${task.number}/runs`}>
            Lịch sử chạy
          </Link>
        </nav>
      </div>
    </dialog>
  );
}
