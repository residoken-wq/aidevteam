import type { Project } from "@aidevteam/contracts";
import Link from "next/link";
import { apiGet, can, type Me } from "../../lib/server-api";
import { CreateProjectForm, ProjectRowActions } from "./project-forms";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const showArchived = (await searchParams).archived === "true";
  const me = await apiGet<Me>("/auth/me");
  const data = await apiGet<{ items: Project[] }>(`/projects?archived=${showArchived ? "true" : "false"}`);
  const canWrite = can(me, "project:write");

  return (
    <main>
      <p>
        <Link href="/">← Trang chủ</Link>
      </p>
      <h1>Dự án {me?.activeOrg ? `— ${me.activeOrg.slug}` : ""}</h1>
      {data === null ? (
        <p role="status">Bạn chưa có quyền xem dự án trong tổ chức này.</p>
      ) : (
        <>
          {canWrite ? <CreateProjectForm /> : null}
          <p>
            {showArchived ? <Link href="/projects">Ẩn dự án đã lưu trữ</Link> : <Link href="/projects?archived=true">Hiện cả dự án đã lưu trữ</Link>}
          </p>
          {data.items.length === 0 ? (
            <p>Chưa có dự án nào.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Tên</th>
                  <th>Mô tả</th>
                  <th>Trạng thái</th>
                  {canWrite ? <th>Thao tác</th> : null}
                </tr>
              </thead>
              <tbody>
                {data.items.map((p) => (
                  <tr key={p.slug} data-testid={`project-${p.slug}`}>
                    <td>{p.slug}</td>
                    <td>{p.name}</td>
                    <td>{p.description ?? ""}</td>
                    <td>{p.archivedAt ? "Đã lưu trữ" : "Đang hoạt động"}</td>
                    {canWrite ? <td>{p.archivedAt ? null : <ProjectRowActions slug={p.slug} name={p.name} />}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </main>
  );
}
