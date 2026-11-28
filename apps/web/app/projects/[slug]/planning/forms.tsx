"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { Milestone, Sprint } from "@aidevteam/contracts";
import { sendJson } from "../../../../lib/api-errors";

// --- Sprints Forms & Actions ---

export function CreateSprintForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const name = String(d.get("name") ?? "");
    const startDate = String(d.get("startDate") ?? "");
    const endDate = String(d.get("endDate") ?? "");

    setBusy(true);
    const r = await sendJson("POST", `/api/projects/${encodeURIComponent(slug)}/sprints`, {
      name,
      startDate,
      endDate,
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} aria-label="Tạo sprint" style={{ marginBottom: "1rem" }}>
      <label>
        Tên sprint <input name="name" required maxLength={120} />
      </label>{" "}
      <label>
        Ngày bắt đầu <input name="startDate" type="date" required />
      </label>{" "}
      <label>
        Ngày kết thúc <input name="endDate" type="date" required />
      </label>{" "}
      <button type="submit" disabled={busy}>
        Tạo sprint
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

export function SprintRowActions({ slug, sprint }: { slug: string; sprint: Sprint }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function transition(to: "ACTIVE" | "CLOSED") {
    const label = to === "ACTIVE" ? "bắt đầu" : "đóng";
    if (!window.confirm(`Xác nhận ${label} sprint #${sprint.number}?`)) return;
    setBusy(true);
    const r = await sendJson("POST", `/api/projects/${encodeURIComponent(slug)}/sprints/${sprint.number}/transitions`, {
      to,
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    router.refresh();
  }

  if (sprint.status === "PLANNED") {
    return (
      <span>
        <button
          type="button"
          disabled={busy}
          data-testid={`start-sprint-${sprint.number}`}
          onClick={() => void transition("ACTIVE")}
        >
          Bắt đầu sprint
        </button>
        {error ? <span role="alert"> {error}</span> : null}
      </span>
    );
  }

  if (sprint.status === "ACTIVE") {
    return (
      <span>
        <button
          type="button"
          disabled={busy}
          data-testid={`close-sprint-${sprint.number}`}
          onClick={() => void transition("CLOSED")}
        >
          Đóng sprint
        </button>
        {error ? <span role="alert"> {error}</span> : null}
      </span>
    );
  }

  return <span>Đã đóng</span>;
}

// --- Epics Forms & Actions ---

export function CreateEpicForm({ slug, milestones }: { slug: string; milestones: Milestone[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const epicSlug = String(d.get("slug") ?? "");
    const title = String(d.get("title") ?? "");
    const description = String(d.get("description") ?? "");
    const milestoneSlug = String(d.get("milestoneSlug") ?? "");

    setBusy(true);
    const r = await sendJson("POST", `/api/projects/${encodeURIComponent(slug)}/epics`, {
      slug: epicSlug,
      title,
      ...(description ? { description } : {}),
      ...(milestoneSlug ? { milestoneSlug } : {}),
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} aria-label="Tạo epic" style={{ marginBottom: "1rem" }}>
      <label>
        Mã epic (slug) <input name="slug" required pattern="^[a-z0-9][a-z0-9-]{1,62}$" />
      </label>{" "}
      <label>
        Tiêu đề <input name="title" required maxLength={200} />
      </label>{" "}
      <label>
        Mô tả <input name="description" maxLength={10000} />
      </label>{" "}
      <label>
        Milestone{" "}
        <select name="milestoneSlug" defaultValue="">
          <option value="">Không gắn milestone</option>
          {milestones.filter((m) => !m.archivedAt).map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.title} ({m.slug})
            </option>
          ))}
        </select>
      </label>{" "}
      <button type="submit" disabled={busy}>
        Tạo epic
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

export function EpicRowActions({ slug, epicSlug, archived }: { slug: string; epicSlug: string; archived: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function archive() {
    if (!window.confirm(`Xác nhận lưu trữ epic ${epicSlug}?`)) return;
    setBusy(true);
    const r = await sendJson("POST", `/api/projects/${encodeURIComponent(slug)}/epics/${encodeURIComponent(epicSlug)}/archive`);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    router.refresh();
  }

  if (archived) return <span>Đã lưu trữ</span>;

  return (
    <span>
      <button
        type="button"
        disabled={busy}
        data-testid={`archive-epic-${epicSlug}`}
        onClick={() => void archive()}
      >
        Lưu trữ
      </button>
      {error ? <span role="alert"> {error}</span> : null}
    </span>
  );
}

// --- Milestones Forms & Actions ---

export function CreateMilestoneForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const d = new FormData(form);
    const milestoneSlug = String(d.get("slug") ?? "");
    const title = String(d.get("title") ?? "");
    const dueDate = String(d.get("dueDate") ?? "");

    setBusy(true);
    const r = await sendJson("POST", `/api/projects/${encodeURIComponent(slug)}/milestones`, {
      slug: milestoneSlug,
      title,
      ...(dueDate ? { dueDate } : {}),
    });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    form.reset();
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} aria-label="Tạo milestone" style={{ marginBottom: "1rem" }}>
      <label>
        Mã milestone (slug) <input name="slug" required pattern="^[a-z0-9][a-z0-9-]{1,62}$" />
      </label>{" "}
      <label>
        Tiêu đề <input name="title" required maxLength={200} />
      </label>{" "}
      <label>
        Hạn chót <input name="dueDate" type="date" />
      </label>{" "}
      <button type="submit" disabled={busy}>
        Tạo milestone
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

export function MilestoneRowActions({ slug, milestoneSlug, archived }: { slug: string; milestoneSlug: string; archived: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function archive() {
    if (!window.confirm(`Xác nhận lưu trữ milestone ${milestoneSlug}?`)) return;
    setBusy(true);
    const r = await sendJson("POST", `/api/projects/${encodeURIComponent(slug)}/milestones/${encodeURIComponent(milestoneSlug)}/archive`);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setError(null);
    router.refresh();
  }

  if (archived) return <span>Đã lưu trữ</span>;

  return (
    <span>
      <button
        type="button"
        disabled={busy}
        data-testid={`archive-milestone-${milestoneSlug}`}
        onClick={() => void archive()}
      >
        Lưu trữ
      </button>
      {error ? <span role="alert"> {error}</span> : null}
    </span>
  );
}
