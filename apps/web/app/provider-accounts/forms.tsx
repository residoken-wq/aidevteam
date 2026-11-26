"use client";

import { PROVIDERS } from "@aidevteam/contracts";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { sendJson } from "../../lib/api-errors";

const REF_HINT = "env:AIDEV_SECRET_<TÊN> hoặc file:/run/secrets/<tên>";

export function CreateProviderAccountForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const description = String(d.get("description") ?? "");
    const r = await sendJson("POST", "/api/provider-accounts", {
      slug: String(d.get("slug") ?? ""),
      name: String(d.get("name") ?? ""),
      provider: String(d.get("provider") ?? ""),
      secretRef: String(d.get("secretRef") ?? ""),
      ...(description ? { description } : {}),
    });
    // Always clear the reference field: if a real secret was pasted by mistake it must not stay on screen.
    const refInput = form.elements.namedItem("secretRef");
    if (refInput instanceof HTMLInputElement) refInput.value = "";
    if (!r.ok) return setError(r.error);
    setError(null);
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} aria-label="Tạo tài khoản provider">
      <label>
        Mã (slug) <input name="slug" required pattern="[a-z0-9][a-z0-9\-]{1,62}" />
      </label>{" "}
      <label>
        Tên <input name="name" required maxLength={120} />
      </label>{" "}
      <label>
        Provider{" "}
        <select name="provider" required defaultValue="anthropic">
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>{" "}
      <label>
        Tham chiếu secret <input name="secretRef" required autoComplete="off" spellCheck={false} placeholder={REF_HINT} size={36} />
      </label>{" "}
      <label>
        Mô tả <input name="description" maxLength={2000} />
      </label>{" "}
      <button type="submit">Tạo tài khoản</button>
      <p>
        <small>Chỉ nhập tham chiếu ({REF_HINT}). Control Center không lưu và không hiển thị secret.</small>
      </p>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

export function ProviderAccountRowActions({ slug, name }: { slug: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  async function rotate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem("secretRef") as HTMLInputElement;
    const r = await sendJson("PATCH", `/api/provider-accounts/${encodeURIComponent(slug)}`, { secretRef: input.value });
    input.value = "";
    if (!r.ok) return setError(r.error);
    setError(null);
    setRotating(false);
    router.refresh();
  }

  async function archive() {
    if (!window.confirm(`Lưu trữ tài khoản provider "${name}"?`)) return;
    const r = await sendJson("POST", `/api/provider-accounts/${encodeURIComponent(slug)}/archive`);
    if (!r.ok) return setError(r.error);
    router.refresh();
  }

  return (
    <span>
      {rotating ? (
        <form onSubmit={rotate} aria-label={`Đổi tham chiếu ${slug}`} style={{ display: "inline" }}>
          <input name="secretRef" required autoComplete="off" spellCheck={false} placeholder={REF_HINT} /> <button type="submit">Lưu</button>{" "}
          <button type="button" onClick={() => setRotating(false)}>
            Hủy
          </button>
        </form>
      ) : (
        <>
          <button type="button" onClick={() => setRotating(true)}>
            Đổi tham chiếu
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
