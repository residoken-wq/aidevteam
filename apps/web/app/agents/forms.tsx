"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { sendJson } from "../../lib/api-errors";

function Select({ name, label, options, empty, defaultValue = "" }: { name: string; label: string; options: string[]; empty: string; defaultValue?: string }) {
  return (
    <label>
      {label}{" "}
      <select name={name} defaultValue={defaultValue}>
        <option value="">{empty}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function CreateAgentForm({ accounts, managers }: { accounts: string[]; managers: string[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const opt = (k: string) => {
      const v = String(d.get(k) ?? "").trim();
      return v ? { [k]: v } : {};
    };
    const capsRaw = String(d.get("capabilities") ?? "");
    const capabilities = capsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const maxActiveTasksRaw = d.get("maxActiveTasks");
    const maxActiveTasks = maxActiveTasksRaw ? Number(maxActiveTasksRaw) : undefined;

    const r = await sendJson("POST", "/api/agents", {
      slug: String(d.get("slug") ?? ""),
      name: String(d.get("name") ?? ""),
      ...opt("title"),
      ...opt("model"),
      ...opt("providerAccountSlug"),
      ...opt("reportsToSlug"),
      ...opt("description"),
      ...(capabilities.length > 0 ? { capabilities } : {}),
      ...(maxActiveTasks !== undefined && !Number.isNaN(maxActiveTasks) ? { maxActiveTasks } : {}),
    });
    if (!r.ok) return setError(r.error);
    setError(null);
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} aria-label="Tạo agent">
      <label>
        Mã (slug) <input name="slug" required pattern="[a-z0-9][a-z0-9\-]{1,62}" />
      </label>{" "}
      <label>
        Tên <input name="name" required maxLength={120} />
      </label>{" "}
      <label>
        Chức danh <input name="title" maxLength={120} />
      </label>{" "}
      <label>
        Model <input name="model" maxLength={100} spellCheck={false} />
      </label>{" "}
      <Select name="providerAccountSlug" label="Tài khoản provider" options={accounts} empty="(chưa gắn)" />{" "}
      <Select name="reportsToSlug" label="Báo cáo cho" options={managers} empty="(không có)" />{" "}
      <label>
        Năng lực (cách nhau bởi dấu phẩy) <input name="capabilities" placeholder="backend, nodejs" />
      </label>{" "}
      <label>
        Số việc tối đa <input name="maxActiveTasks" type="number" min={1} max={50} defaultValue={3} />
      </label>{" "}
      <label>
        Mô tả <input name="description" maxLength={2000} />
      </label>{" "}
      <button type="submit">Tạo agent</button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

export function AgentRowActions({ slug, name, enabled, reportsTo, managers }: { slug: string; name: string; enabled: boolean; reportsTo: string | null; managers: string[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    const r = await sendJson("PATCH", `/api/agents/${encodeURIComponent(slug)}`, body);
    if (!r.ok) return setError(r.error);
    setError(null);
    router.refresh();
  }

  async function onManager(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = String(new FormData(e.currentTarget).get("reportsToSlug") ?? "");
    await patch({ reportsToSlug: v || null });
  }

  async function archive() {
    if (!window.confirm(`Lưu trữ agent "${name}"?`)) return;
    const r = await sendJson("POST", `/api/agents/${encodeURIComponent(slug)}/archive`);
    if (!r.ok) return setError(r.error);
    setError(null);
    router.refresh();
  }

  return (
    <span>
      <form onSubmit={onManager} aria-label={`Đổi cấp trên ${slug}`} style={{ display: "inline" }}>
        <Select name="reportsToSlug" label="Cấp trên" options={managers} empty="(không có)" defaultValue={reportsTo ?? ""} /> <button type="submit">Lưu cấp trên</button>
      </form>{" "}
      <button type="button" onClick={() => patch({ enabled: !enabled })}>
        {enabled ? "Tắt" : "Bật"}
      </button>{" "}
      <button type="button" onClick={archive}>
        Lưu trữ
      </button>
      {error ? <span role="alert"> {error}</span> : null}
    </span>
  );
}
