"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { sendJson } from "../../lib/api-errors";

export function CreateProjectForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const description = String(data.get("description") ?? "");
    setBusy(true);
    const r = await sendJson("POST", "/api/projects", {
      slug: String(data.get("slug") ?? ""),
      name: String(data.get("name") ?? ""),
      ...(description ? { description } : {}),
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} aria-label="Tạo dự án">
      <label>
        Mã (slug) <input name="slug" required pattern="[a-z0-9][a-z0-9\-]{1,62}" title="2–63 ký tự: chữ thường, số và dấu -" placeholder="vd: control-center" />
      </label>{" "}
      <label>
        Tên <input name="name" required maxLength={120} />
      </label>{" "}
      <label>
        Mô tả <input name="description" maxLength={2000} />
      </label>{" "}
      <button type="submit" disabled={busy}>
        Tạo dự án
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

export function ProjectRowActions({ slug, name }: { slug: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  async function rename(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = await sendJson("PATCH", `/api/projects/${encodeURIComponent(slug)}`, { name: String(new FormData(e.currentTarget).get("name") ?? "") });
    if (!r.ok) return setError(r.error);
    setError(null);
    setEditing(false);
    router.refresh();
  }

  async function archive() {
    if (!window.confirm(`Lưu trữ dự án "${name}"?`)) return;
    const r = await sendJson("POST", `/api/projects/${encodeURIComponent(slug)}/archive`);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  return (
    <span>
      {editing ? (
        <form onSubmit={rename} aria-label={`Đổi tên ${slug}`} style={{ display: "inline" }}>
          <input name="name" defaultValue={name} required maxLength={120} /> <button type="submit">Lưu</button>{" "}
          <button type="button" onClick={() => setEditing(false)}>
            Hủy
          </button>
        </form>
      ) : (
        <>
          <button type="button" onClick={() => setEditing(true)}>
            Đổi tên
          </button>{" "}
          <button type="button" onClick={archive}>
            Lưu trữ
          </button>
        </>
      )}
      {error ? <span role="alert"> {error}</span> : null}
    </span>
  );
}
