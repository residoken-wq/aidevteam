import type { Agent, Project, ProjectTaskDependencies, Task, TaskDependencies, Worker } from "@aidevteam/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiGet, can, type Me } from "../../../../lib/server-api";
import { Board } from "./board";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

export default async function TasksPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) notFound();
  const me = await apiGet<Me>("/auth/me");
  const project = await apiGet<Project>(`/projects/${slug}`);
  const data = await apiGet<{ items: Task[] }>(`/projects/${slug}/tasks?limit=500`);
  const canWrite = can(me, "task:write") && project !== null && project.archivedAt === null;
  const canDispatch = can(me, "dispatch:execute") && project !== null && project.archivedAt === null;
  const agents = canWrite ? ((await apiGet<{ items: Agent[] }>("/agents?limit=100"))?.items ?? []).filter((a) => a.enabled).map((a) => a.slug) : [];
  const workers = canDispatch
    ? ((await apiGet<{ items: Worker[] }>("/workers?limit=100"))?.items ?? [])
        .filter((w) => w.enabled && !w.archivedAt && w.type === "mock")
        .map((w) => ({ slug: w.slug, name: w.name }))
    : [];

  // One request for every edge of the project (not one per task), then group per task number.
  const depsMap: Record<number, TaskDependencies> = {};
  if (data?.items && data.items.length > 0) {
    const edges = (await apiGet<ProjectTaskDependencies>(`/projects/${encodeURIComponent(slug)}/task-dependencies`))?.items ?? [];
    const entry = (n: number): TaskDependencies => (depsMap[n] ??= { dependsOn: [], blockedBy: [], dependents: [] });
    for (const e of edges) {
      entry(e.task.number).dependsOn.push(e.dependsOn);
      if (e.dependsOn.status !== "DONE") entry(e.task.number).blockedBy.push(e.dependsOn);
      entry(e.dependsOn.number).dependents.push(e.task);
    }
  }

  return (
    <div>
      <p>
        <Link href="/projects">← Dự án</Link>
      </p>
      <h1>Task — {project?.name ?? slug}</h1>
      {can(me, "project:assign") ? (
        <nav aria-label="Project tabs" style={{ marginBottom: "1rem" }}>
          <strong>Task</strong>
          <span style={{ margin: "0 0.5rem" }}>|</span>
          <Link href={`/projects/${slug}/members`}>Thành viên dự án</Link>
        </nav>
      ) : null}
      {data === null || project === null ? (
        <p role="status">Bạn chưa có quyền xem task của dự án này.</p>
      ) : (
        <>
          {project.archivedAt ? <p role="status">Dự án đã lưu trữ: chỉ xem, không sửa được.</p> : null}
          <Board
            projectSlug={slug}
            initial={data.items}
            initialDeps={depsMap}
            canWrite={canWrite}
            canDispatch={canDispatch}
            agents={agents}
            workers={workers}
          />
        </>
      )}
    </div>
  );
}
