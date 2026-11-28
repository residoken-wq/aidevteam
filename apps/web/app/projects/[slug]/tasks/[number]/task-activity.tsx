"use client";

import type { TaskActivityResponse } from "@aidevteam/contracts";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { sendJson } from "../../../../../lib/api-errors";

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

export function TaskActivityView({
  projectSlug,
  taskNumber,
  initialActivity,
  canWrite,
}: {
  projectSlug: string;
  taskNumber: number;
  initialActivity: TaskActivityResponse;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [activity, setActivity] = useState<TaskActivityResponse>(initialActivity);
  const [commentBody, setCommentBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function reloadActivity() {
    try {
      const res = await fetch(
        `/api/projects/${encodeURIComponent(projectSlug)}/tasks/${taskNumber}/activity`,
      );
      if (res.ok) {
        setActivity((await res.json()) as TaskActivityResponse);
      }
    } catch {
      // ignore
    }
  }

  async function onSubmitComment(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = commentBody.trim();
    if (!trimmed) {
      setError("Vui lòng nhập nội dung bình luận.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const r = await sendJson(
      "POST",
      `/api/projects/${encodeURIComponent(projectSlug)}/tasks/${taskNumber}/comments`,
      { body: commentBody },
    );

    if (!r.ok) {
      setError(r.error);
      setSubmitting(false);
      return;
    }

    setCommentBody("");
    setSubmitting(false);
    await reloadActivity();
    router.refresh();
  }

  const items = activity.items ?? [];

  return (
    <section aria-label="Dòng thời gian hoạt động và bình luận" data-testid="task-activity-section">
      <h2>Hoạt động ({items.length})</h2>

      {items.length === 0 ? (
        <p>(Chưa có hoạt động)</p>
      ) : (
        <ul style={{ listStyle: "none", paddingLeft: 0 }}>
          {items.map((item, idx) => {
            const author = item.actorLogin
              ? `@${item.actorLogin}`
              : item.actorGithubUserId
                ? `#${item.actorGithubUserId}`
                : "Hệ thống";
            const dateStr = new Date(item.at).toLocaleString("vi-VN");

            return (
              <li
                key={`${item.kind}-${item.at}-${idx}`}
                data-testid={`activity-item-${idx}`}
                style={{
                  marginBottom: "1rem",
                  padding: "0.75rem",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                  backgroundColor: item.kind === "comment" ? "#fbfbfb" : "#f5f5f5",
                }}
              >
                <div style={{ fontSize: "0.85rem", color: "#666", marginBottom: "0.25rem" }}>
                  <strong>{author}</strong>{" "}
                  {item.kind === "comment" ? "đã bình luận" : formatAction(item.action)}{" "}
                  vào <time dateTime={item.at}>{dateStr}</time>
                </div>

                {item.kind === "comment" ? (
                  <p
                    data-testid="comment-body"
                    style={{
                      margin: 0,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {item.body}
                  </p>
                ) : (
                  <div>
                    {item.details && Object.keys(item.details).length > 0 ? (
                      <span style={{ fontSize: "0.9rem", color: "#444" }}>
                        {formatDetails(item.details)}
                      </span>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canWrite ? (
        <form
          onSubmit={onSubmitComment}
          aria-label="Thêm bình luận"
          style={{ marginTop: "1.5rem" }}
        >
          <h3>Thêm bình luận</h3>
          <div>
            <textarea
              name="body"
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              placeholder="Viết bình luận (1–5000 ký tự)..."
              rows={4}
              maxLength={5000}
              required
              aria-label="Nội dung bình luận"
              style={{ width: "100%", maxWidth: "600px", display: "block", marginBottom: "0.5rem" }}
            />
          </div>
          <button type="submit" disabled={submitting}>
            {submitting ? "Đang gửi..." : "Gửi bình luận"}
          </button>
          {error ? (
            <p role="alert" style={{ color: "#c00", marginTop: "0.5rem" }}>
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
