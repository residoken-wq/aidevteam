"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { sendJson } from "../../../../lib/api-errors";

export function AssignProjectMemberForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const githubUserId = Number(d.get("githubUserId"));
    const access = String(d.get("access") ?? "read");

    setBusy(true);
    const r = await sendJson("POST", `/api/projects/${encodeURIComponent(slug)}/members`, {
      githubUserId,
      access,
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} aria-label="Giao dự án cho thành viên">
      <label>
        GitHub ID <input name="githubUserId" type="number" required min="1" step="1" />
      </label>{" "}
      <label>
        Quyền truy cập{" "}
        <select name="access" required defaultValue="read">
          <option value="read">Chỉ xem (read)</option>
          <option value="write">Chỉnh sửa / Dispatch (write)</option>
        </select>
      </label>{" "}
      <button type="submit" disabled={busy}>
        Giao dự án
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

export function ProjectMemberRowActions({ slug, githubUserId }: { slug: string; githubUserId: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function unassign() {
    if (!window.confirm(`Gỡ thành viên ${githubUserId} khỏi dự án?`)) return;
    const r = await sendJson("DELETE", `/api/projects/${encodeURIComponent(slug)}/members`, {
      githubUserId,
    });
    if (!r.ok) return setError(r.error);
    setError(null);
    router.refresh();
  }

  return (
    <span>
      <button
        type="button"
        data-testid={`unassign-${githubUserId}`}
        onClick={unassign}
      >
        Gỡ khỏi dự án
      </button>
      {error ? <span role="alert"> {error}</span> : null}
    </span>
  );
}
