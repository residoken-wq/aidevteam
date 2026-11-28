import type { Project, ProjectMember } from "@aidevteam/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiGet, can, type Me } from "../../../../lib/server-api";
import { AssignProjectMemberForm, ProjectMemberRowActions } from "./forms";

export const dynamic = "force-dynamic";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

export default async function ProjectMembersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG_RE.test(slug)) notFound();

  const me = await apiGet<Me>("/auth/me");
  const project = await apiGet<Project>(`/projects/${slug}`);
  if (project === null) notFound();

  const canAssign = can(me, "project:assign");
  const members = canAssign ? await apiGet<ProjectMember[]>(`/projects/${slug}/members`) : null;

  return (
    <div>
      <p>
        <Link href="/projects">← Dự án</Link>
      </p>
      <h1>Dự án: {project.name} ({slug})</h1>
      <nav aria-label="Project tabs" style={{ marginBottom: "1rem" }}>
        <Link href={`/projects/${slug}/tasks`} style={{ marginRight: "1rem" }}>
          Task
        </Link>
        <Link href={`/projects/${slug}/planning`} style={{ marginRight: "1rem" }}>
          Kế hoạch
        </Link>
        <strong>Thành viên dự án</strong>
      </nav>

      {!canAssign ? (
        <p role="status">Bạn chưa có quyền quản lý thành viên dự án này.</p>
      ) : (
        <>
          <AssignProjectMemberForm slug={slug} />
          {members === null || members.length === 0 ? (
            <p>Chưa có thành viên nào được giao dự án này.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>GitHub ID</th>
                  <th>Login</th>
                  <th>Quyền truy cập</th>
                  <th>Ngày giao</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.githubUserId} data-testid={`project-member-${m.githubUserId}`}>
                    <td>{m.githubUserId}</td>
                    <td>{m.githubLogin ?? "—"}</td>
                    <td>{m.access === "write" ? "Chỉnh sửa / Dispatch (write)" : "Chỉ xem (read)"}</td>
                    <td>{m.createdAt}</td>
                    <td>
                      <ProjectMemberRowActions slug={slug} githubUserId={m.githubUserId} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
