import type { Agent, Epic, Project, Sprint, Task, Worker } from "@aidevteam/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiGet, can, type Me } from "../../../../lib/server-api";
import { Board } from "./board";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

export default async function TasksPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ epic?: string; sprint?: string }>;
}) {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) notFound();
  const sp = (await searchParams) ?? {};
  const epicFilter = sp.epic?.trim() || undefined;
  const sprintFilter = sp.sprint?.trim() || undefined;

  const me = await apiGet<Me>("/auth/me");
  const project = await apiGet<Project>(`/projects/${slug}`);

  let tasksUrl = `/projects/${slug}/tasks?limit=500`;
  if (epicFilter) tasksUrl += `&epic=${encodeURIComponent(epicFilter)}`;
  if (sprintFilter) tasksUrl += `&sprint=${encodeURIComponent(sprintFilter)}`;

  const [data, epicsData, sprintsData] = await Promise.all([
    apiGet<{ items: Task[] }>(tasksUrl),
    apiGet<{ items: Epic[] }>(`/projects/${slug}/epics?limit=100`),
    apiGet<{ items: Sprint[] }>(`/projects/${slug}/sprints?limit=100`),
  ]);

  const epics = epicsData?.items ?? [];
  const sprints = sprintsData?.items ?? [];

  const canWrite = can(me, "task:write") && project !== null && project.archivedAt === null;
  const canDispatch = can(me, "dispatch:execute") && project !== null && project.archivedAt === null;
  const agents = canWrite ? ((await apiGet<{ items: Agent[] }>("/agents?limit=100"))?.items ?? []).filter((a) => a.enabled).map((a) => a.slug) : [];
  const workers = canDispatch
    ? ((await apiGet<{ items: Worker[] }>("/workers?limit=100"))?.items ?? [])
        .filter((w) => w.enabled && !w.archivedAt && w.type === "mock")
        .map((w) => ({ slug: w.slug, name: w.name }))
    : [];

  return (
    <div>
      <p>
        <Link href="/projects">← Dự án</Link>
      </p>
      <h1>Task — {project?.name ?? slug}</h1>
      <nav aria-label="Project tabs" style={{ marginBottom: "1rem" }}>
        <strong style={{ marginRight: "1rem" }}>Task</strong>
        <Link href={`/projects/${slug}/planning`} style={{ marginRight: "1rem" }}>
          Kế hoạch
        </Link>
        {can(me, "project:assign") ? (
          <Link href={`/projects/${slug}/members`}>Thành viên dự án</Link>
        ) : null}
      </nav>
      {data === null || project === null ? (
        <p role="status">Bạn chưa có quyền xem task của dự án này.</p>
      ) : (
        <>
          {project.archivedAt ? <p role="status">Dự án đã lưu trữ: chỉ xem, không sửa được.</p> : null}
          <Board
            projectSlug={slug}
            initial={data.items}
            canWrite={canWrite}
            canDispatch={canDispatch}
            agents={agents}
            workers={workers}
            epics={epics}
            sprints={sprints}
            currentEpic={epicFilter}
            currentSprint={sprintFilter}
          />
        </>
      )}
    </div>
  );
}
