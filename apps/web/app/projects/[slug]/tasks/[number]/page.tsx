import type { Project, Task, TaskActivityResponse, TaskDependencies } from "@aidevteam/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiGet, can, type Me } from "../../../../../lib/server-api";
import { TaskDetailView } from "./task-detail";
import { TaskActivityView } from "./task-activity";

export const dynamic = "force-dynamic";

const NUMBER_RE = /^[1-9][0-9]{0,8}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ slug: string; number: string }>;
}) {
  const { slug, number: numberStr } = await params;
  if (!SLUG_RE.test(slug) || !NUMBER_RE.test(numberStr)) notFound();

  const me = await apiGet<Me>("/auth/me");
  if (!can(me, "task:read")) {
    return (
      <div>
        <p>
          <Link href={`/projects/${encodeURIComponent(slug)}/tasks`}>← Task dự án</Link>
        </p>
        <p role="status">Bạn chưa có quyền xem task này.</p>
      </div>
    );
  }

  const project = await apiGet<Project>(`/projects/${slug}`);
  const task = await apiGet<Task>(`/projects/${encodeURIComponent(slug)}/tasks/${numberStr}`);
  const deps = await apiGet<TaskDependencies>(`/projects/${encodeURIComponent(slug)}/tasks/${numberStr}/dependencies`);
  const activity = await apiGet<TaskActivityResponse>(`/projects/${encodeURIComponent(slug)}/tasks/${numberStr}/activity`);

  if (project === null || task === null || deps === null) notFound();

  const canWrite = can(me, "task:write") && project.archivedAt === null;

  return (
    <div>
      <p>
        <Link href={`/projects/${encodeURIComponent(slug)}/tasks`}>← Task dự án</Link>
      </p>
      <h1>Task #{numberStr} — {task.title}</h1>
      <TaskDetailView
        projectSlug={slug}
        task={task}
        initialDeps={deps}
        canWrite={canWrite}
      />
      <hr style={{ margin: "1rem 0" }} />
      <TaskActivityView
        projectSlug={slug}
        taskNumber={task.number}
        initialActivity={activity ?? { items: [], limit: 50, offset: 0 }}
        canWrite={canWrite}
      />
    </div>
  );
}
