import type { Project, Worker } from "@aidevteam/contracts";
import Link from "next/link";
import { apiGet, can, type Me } from "../../lib/server-api";
import { CreateWorkerForm, WorkerRowActions } from "./forms";

export const dynamic = "force-dynamic";

export default async function WorkersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const showArchived = (await searchParams).archived === "true";
  const me = await apiGet<Me>("/auth/me");
  const data = await apiGet<{ items: Worker[] }>(`/workers?archived=${showArchived ? "true" : "false"}`);
  const canWrite = can(me, "worker:write");
  const projects = canWrite ? ((await apiGet<{ items: Project[] }>("/projects?limit=100"))?.items ?? []) : [];
  const projectSlugs = projects.map((p) => p.slug);

  return (
    <main>
      <p>
        <Link href="/">← Trang chủ</Link>
      </p>
      <h1>Worker {me?.activeOrg ? `— ${me.activeOrg.slug}` : ""}</h1>
      <p>
        <small>Release 0.1 chỉ có worker loại <code>mock</code>; chưa chạy agent thật.</small>
      </p>
      {data === null ? (
        <p role="status">Bạn chưa có quyền xem worker trong tổ chức này.</p>
      ) : (
        <>
          {canWrite ? <CreateWorkerForm projects={projectSlugs} /> : null}
          <p>{showArchived ? <Link href="/workers">Ẩn mục đã lưu trữ</Link> : <Link href="/workers?archived=true">Hiện cả mục đã lưu trữ</Link>}</p>
          {data.items.length === 0 ? (
            <p>Chưa có worker nào.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Tên</th>
                  <th>Loại</th>
                  <th>Thư mục làm việc</th>
                  <th>Dự án</th>
                  <th>Trạng thái</th>
                  {canWrite ? <th>Thao tác</th> : null}
                </tr>
              </thead>
              <tbody>
                {data.items.map((w) => (
                  <tr key={w.slug} data-testid={`worker-${w.slug}`}>
                    <td>{w.slug}</td>
                    <td>{w.name}</td>
                    <td>{w.type}</td>
                    <td>
                      <code>{w.workspacePath}</code>
                    </td>
                    <td>{w.projectSlug ?? "—"}</td>
                    <td>{w.archivedAt ? "Đã lưu trữ" : w.enabled ? "Đang bật" : "Đã tắt"}</td>
                    {canWrite ? <td>{w.archivedAt ? null : <WorkerRowActions slug={w.slug} name={w.name} enabled={w.enabled} />}</td> : null}
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
