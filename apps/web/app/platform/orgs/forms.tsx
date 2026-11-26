"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { sendJson } from "../../../lib/api-errors";

export function CreateOrgForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const r = await sendJson("POST", "/api/platform/orgs", { slug: String(d.get("slug") ?? ""), name: String(d.get("name") ?? "") });
    if (!r.ok) return setError(r.error);
    setError(null);
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} aria-label="Tạo tổ chức">
      <label>
        Mã (slug) <input name="slug" required pattern="[a-z0-9][a-z0-9\-]{1,62}" />
      </label>{" "}
      <label>
        Tên <input name="name" required maxLength={200} />
      </label>{" "}
      <button type="submit">Tạo tổ chức</button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

export function OrgRowActions({ slug, name, archived }: { slug: string; name: string; archived: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);

  async function rename(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("name") as HTMLInputElement;
    const r = await sendJson("PATCH", `/api/platform/orgs/${encodeURIComponent(slug)}`, { name: input.value });
    if (!r.ok) return setError(r.error);
    setError(null);
    setRenaming(false);
    router.refresh();
  }

  async function act(action: "archive" | "restore") {
    const question =
      action === "archive"
        ? `Lưu trữ tổ chức "${name}"? Mọi thành viên sẽ không truy cập được tổ chức này cho tới khi khôi phục. Dữ liệu được giữ nguyên.`
        : `Khôi phục tổ chức "${name}"?`;
    if (!window.confirm(question)) return;
    const r = await sendJson("POST", `/api/platform/orgs/${encodeURIComponent(slug)}/${action}`);
    if (!r.ok) return setError(r.error);
    setError(null);
    router.refresh();
  }

  return (
    <span>
      {archived ? (
        <button type="button" onClick={() => act("restore")}>
          Khôi phục
        </button>
      ) : renaming ? (
        <form onSubmit={rename} aria-label={`Đổi tên ${slug}`} style={{ display: "inline" }}>
          <input name="name" required maxLength={200} defaultValue={name} /> <button type="submit">Lưu</button>{" "}
          <button type="button" onClick={() => setRenaming(false)}>
            Hủy
          </button>
        </form>
      ) : (
        <>
          <button type="button" onClick={() => setRenaming(true)}>
            Đổi tên
          </button>{" "}
          <button type="button" onClick={() => act("archive")}>
            Lưu trữ
          </button>
        </>
      )}
      {error ? <span role="alert"> {error}</span> : null}
    </span>
  );
}
