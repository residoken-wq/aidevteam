"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { roleLabel } from "../../lib/roles";
import { sendJson } from "../../lib/api-errors";

export function AssignRoleForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const githubUserId = Number(d.get("githubUserId"));
    const role = String(d.get("role") ?? "");

    const r = await sendJson("POST", "/api/org/members/roles", {
      githubUserId,
      role,
    });
    if (!r.ok) return setError(r.error);
    setError(null);
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} aria-label="Gán vai trò">
      <label>
        GitHub ID <input name="githubUserId" type="number" required min="1" step="1" />
      </label>{" "}
      <label>
        Vai trò{" "}
        <select name="role" required defaultValue="viewer">
          <option value="viewer">Chỉ xem (viewer)</option>
          <option value="maintainer">Vận hành (maintainer)</option>
          <option value="org_admin">Quản trị tổ chức (org_admin)</option>
          <option value="project_member">Thành viên dự án (project_member)</option>
        </select>
      </label>{" "}
      <button type="submit">Gán vai trò</button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

export function MemberRowActions({ githubUserId, roles }: { githubUserId: number; roles: string[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function revoke(role: string) {
    const r = await sendJson("DELETE", "/api/org/members/roles", {
      githubUserId,
      role,
    });
    if (!r.ok) return setError(r.error);
    setError(null);
    router.refresh();
  }

  return (
    <span>
      {roles.map((r) => (
        <button
          key={r}
          type="button"
          data-testid={`revoke-${githubUserId}-${r}`}
          onClick={() => revoke(r)}
          style={{ marginRight: "0.5rem" }}
        >
          Gỡ {roleLabel(r)}
        </button>
      ))}
      {error ? <span role="alert"> {error}</span> : null}
    </span>
  );
}
