"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { sendJson } from "../../lib/api-errors";

export function CreateWorkerForm({ projects }: { projects: string[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const description = String(d.get("description") ?? "");
    const projectSlug = String(d.get("projectSlug") ?? "");
    const r = await sendJson("POST", "/api/workers", {
      slug: String(d.get("slug") ?? ""),
      name: String(d.get("name") ?? ""),
      type: "mock",
      workspacePath: String(d.get("workspacePath") ?? ""),
      ...(projectSlug ? { projectSlug } : {}),
      ...(description ? { description } : {}),
    });
    if (!r.ok) return setError(r.error);
    setError(null);
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} aria-label="Tạo worker">
      <label>
        Mã (slug) <input name="slug" required pattern="[a-z0-9][a-z0-9\-]{1,62}" />
      </label>{" "}
      <label>
        Tên <input name="name" required maxLength={120} />
      </label>{" "}
      <label>
        Thư mục làm việc <input name="workspacePath" required maxLength={255} spellCheck={false} placeholder="/srv/workspaces/<tên>" />
      </label>{" "}
      <label>
        Dự án{" "}
        <select name="projectSlug" defaultValue="">
          <option value="">(không gắn)</option>
          {projects.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>{" "}
      <label>
        Mô tả <input name="description" maxLength={2000} />
      </label>{" "}
      <button type="submit">Tạo worker</button>
      <p>
        <small>Đường dẫn tuyệt đối, tối thiểu 2 cấp, không trùng/lồng với worker đang hoạt động, không nằm trong thư mục hệ thống.</small>
      </p>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

export function WorkerRowActions({ slug, name, enabled }: { slug: string; name: string; enabled: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const r = await sendJson("PATCH", `/api/workers/${encodeURIComponent(slug)}`, { enabled: !enabled });
    if (!r.ok) return setError(r.error);
    setError(null);
    router.refresh();
  }

  async function archive() {
    if (!window.confirm(`Lưu trữ worker "${name}"? Thư mục làm việc sẽ được giải phóng.`)) return;
    const r = await sendJson("POST", `/api/workers/${encodeURIComponent(slug)}/archive`);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  return (
    <span>
      <button type="button" onClick={toggle}>
        {enabled ? "Tắt" : "Bật"}
      </button>{" "}
      <button type="button" onClick={archive}>
        Lưu trữ
      </button>
      {error ? <span role="alert"> {error}</span> : null}
    </span>
  );
}
