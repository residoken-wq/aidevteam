import type { Run } from "@aidevteam/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiGet, can, type Me } from "../../../../../../lib/server-api";

export const dynamic = "force-dynamic";

const NUMBER_RE = /^[1-9][0-9]{0,8}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

export default async function TaskRunsPage({
  params,
}: {
  params: Promise<{ slug: string; number: string }>;
}) {
  const { slug, number: numberStr } = await params;
  if (!SLUG_RE.test(slug) || !NUMBER_RE.test(numberStr)) notFound();

  const me = await apiGet<Me>("/auth/me");
  if (!can(me, "run:read")) {
    return (
      <main>
        <p>
          <Link href={`/projects/${encodeURIComponent(slug)}/tasks`}>← Task dự án</Link>
        </p>
        <p role="status">Bạn chưa có quyền xem lịch sử chạy.</p>
      </main>
    );
  }

  const data = await apiGet<{ items: Run[] }>(
    `/projects/${encodeURIComponent(slug)}/tasks/${numberStr}/runs`,
  );
  if (data === null) notFound();

  return (
    <main>
      <p>
        <Link href={`/projects/${encodeURIComponent(slug)}/tasks`}>← Task dự án</Link>
      </p>
      <h1>Lịch sử chạy — Task #{numberStr} ({slug})</h1>
      {data.items.length === 0 ? (
        <p>Chưa có lượt chạy nào.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Lần thử</th>
              <th>Worker</th>
              <th>Trạng thái</th>
              <th>Thời điểm xếp hàng</th>
              <th>Bắt đầu</th>
              <th>Kết thúc</th>
              <th>Chi tiết</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((r) => (
              <tr key={r.id} data-testid={`run-row-${r.id}`}>
                <td>#{r.attempt}</td>
                <td>{r.workerSlug}</td>
                <td>{r.status}</td>
                <td>{r.queuedAt}</td>
                <td>{r.startedAt ?? "—"}</td>
                <td>{r.finishedAt ?? "—"}</td>
                <td>
                  <Link href={`/runs/${r.id}`}>Chi tiết</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
