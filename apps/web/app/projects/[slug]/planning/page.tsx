import type { Epic, Milestone, Project, Sprint } from "@aidevteam/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiGet, can, type Me } from "../../../../lib/server-api";
import {
  CreateEpicForm,
  CreateMilestoneForm,
  CreateSprintForm,
  EpicRowActions,
  MilestoneRowActions,
  SprintRowActions,
} from "./forms";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

const SPRINT_STATUS_LABEL: Record<Sprint["status"], string> = {
  PLANNED: "Lên kế hoạch (PLANNED)",
  ACTIVE: "Đang diễn ra (ACTIVE)",
  CLOSED: "Đã đóng (CLOSED)",
};

export default async function PlanningPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) notFound();

  const me = await apiGet<Me>("/auth/me");
  const project = await apiGet<Project>(`/projects/${slug}`);
  if (project === null) notFound();

  const canWrite = can(me, "project:write") && project.archivedAt === null;

  const [epicsData, milestonesData, sprintsData] = await Promise.all([
    apiGet<{ items: Epic[] }>(`/projects/${slug}/epics?limit=100`),
    apiGet<{ items: Milestone[] }>(`/projects/${slug}/milestones?limit=100`),
    apiGet<{ items: Sprint[] }>(`/projects/${slug}/sprints?limit=100`),
  ]);

  const epics = epicsData?.items ?? [];
  const milestones = milestonesData?.items ?? [];
  const sprints = sprintsData?.items ?? [];

  return (
    <div>
      <p>
        <Link href="/projects">← Dự án</Link>
      </p>
      <h1>Kế hoạch — {project.name} ({slug})</h1>
      <nav aria-label="Project tabs" style={{ marginBottom: "1rem" }}>
        <Link href={`/projects/${slug}/tasks`} style={{ marginRight: "1rem" }}>
          Task
        </Link>
        <strong style={{ marginRight: "1rem" }}>Kế hoạch</strong>
        {can(me, "project:assign") ? (
          <Link href={`/projects/${slug}/members`}>Thành viên dự án</Link>
        ) : null}
      </nav>

      {project.archivedAt ? <p role="status">Dự án đã lưu trữ: chỉ xem, không sửa được.</p> : null}

      {/* Sprints Section */}
      <section style={{ marginBottom: "2rem" }}>
        <h2>Sprint</h2>
        {canWrite ? <CreateSprintForm slug={slug} /> : null}
        {sprints.length === 0 ? (
          <p>Chưa có sprint nào.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Số</th>
                <th>Tên sprint</th>
                <th>Ngày bắt đầu</th>
                <th>Ngày kết thúc</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {sprints.map((s) => (
                <tr key={s.number} data-testid={`sprint-row-${s.number}`}>
                  <td>#{s.number}</td>
                  <td>{s.name}</td>
                  <td>{s.startDate}</td>
                  <td>{s.endDate}</td>
                  <td>{SPRINT_STATUS_LABEL[s.status]}</td>
                  <td>
                    {canWrite ? <SprintRowActions slug={slug} sprint={s} /> : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Epics Section */}
      <section style={{ marginBottom: "2rem" }}>
        <h2>Epic</h2>
        {canWrite ? <CreateEpicForm slug={slug} milestones={milestones} /> : null}
        {epics.length === 0 ? (
          <p>Chưa có epic nào.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Mã (slug)</th>
                <th>Tiêu đề</th>
                <th>Mô tả</th>
                <th>Milestone</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {epics.map((e) => (
                <tr key={e.slug} data-testid={`epic-row-${e.slug}`}>
                  <td>{e.slug}</td>
                  <td>{e.title}</td>
                  <td>{e.description ?? "—"}</td>
                  <td>{e.milestoneSlug ?? "—"}</td>
                  <td>{e.archivedAt ? "Đã lưu trữ" : "Đang hoạt động"}</td>
                  <td>
                    {canWrite ? (
                      <EpicRowActions slug={slug} epicSlug={e.slug} archived={Boolean(e.archivedAt)} />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Milestones Section */}
      <section style={{ marginBottom: "2rem" }}>
        <h2>Milestone</h2>
        {canWrite ? <CreateMilestoneForm slug={slug} /> : null}
        {milestones.length === 0 ? (
          <p>Chưa có milestone nào.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Mã (slug)</th>
                <th>Tiêu đề</th>
                <th>Hạn chót</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {milestones.map((m) => (
                <tr key={m.slug} data-testid={`milestone-row-${m.slug}`}>
                  <td>{m.slug}</td>
                  <td>{m.title}</td>
                  <td>{m.dueDate ?? "—"}</td>
                  <td>{m.archivedAt ? "Đã lưu trữ" : "Đang hoạt động"}</td>
                  <td>
                    {canWrite ? (
                      <MilestoneRowActions slug={slug} milestoneSlug={m.slug} archived={Boolean(m.archivedAt)} />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
