import type { Dashboard } from "@aidevteam/contracts";
import Link from "next/link";
import { apiGet, type Me } from "../../lib/server-api";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const me = await apiGet<Me>("/auth/me");
  const data = await apiGet<Dashboard>("/dashboard");

  return (
    <div>
      <p>
        <Link href="/">← Trang chủ</Link>
      </p>
      <h1>Tổng quan {me?.activeOrg ? `— ${me.activeOrg.slug}` : ""}</h1>

      {data === null ? (
        <p role="status">Bạn chưa có quyền xem tổng quan trong tổ chức này.</p>
      ) : (
        <>
          <section>
            <h2>Dự án</h2>
            <p>
              Dự án đang dùng: <strong data-testid="stat-projects-active">{data.projects.active}</strong>
            </p>
          </section>

          <section>
            <h2>Agent</h2>
            <p>
              Đang bật: <strong data-testid="stat-agents-enabled">{data.agents.enabled}</strong> · Đã tắt:{" "}
              <strong data-testid="stat-agents-disabled">{data.agents.disabled}</strong>
            </p>
          </section>

          <section>
            <h2>Worker</h2>
            <p>
              Đang bật: <strong data-testid="stat-workers-enabled">{data.workers.enabled}</strong> · Đã tắt:{" "}
              <strong data-testid="stat-workers-disabled">{data.workers.disabled}</strong>
            </p>
          </section>

          <section>
            <h2>Task</h2>
            <table>
              <thead>
                <tr>
                  <th>BACKLOG</th>
                  <th>TODO</th>
                  <th>IN_PROGRESS</th>
                  <th>IN_REVIEW</th>
                  <th>DONE</th>
                  <th>CANCELLED</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td data-testid="stat-tasks-BACKLOG">{data.tasks.BACKLOG}</td>
                  <td data-testid="stat-tasks-TODO">{data.tasks.TODO}</td>
                  <td data-testid="stat-tasks-IN_PROGRESS">{data.tasks.IN_PROGRESS}</td>
                  <td data-testid="stat-tasks-IN_REVIEW">{data.tasks.IN_REVIEW}</td>
                  <td data-testid="stat-tasks-DONE">{data.tasks.DONE}</td>
                  <td data-testid="stat-tasks-CANCELLED">{data.tasks.CANCELLED}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section>
            <h2>Lượt chạy (7 ngày qua)</h2>
            <table>
              <thead>
                <tr>
                  <th>QUEUED</th>
                  <th>RUNNING</th>
                  <th>SUCCEEDED</th>
                  <th>FAILED</th>
                  <th>CANCELLED</th>
                  <th>INTERRUPTED</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td data-testid="stat-runs7d-QUEUED">{data.runs7d.QUEUED}</td>
                  <td data-testid="stat-runs7d-RUNNING">{data.runs7d.RUNNING}</td>
                  <td data-testid="stat-runs7d-SUCCEEDED">{data.runs7d.SUCCEEDED}</td>
                  <td data-testid="stat-runs7d-FAILED">{data.runs7d.FAILED}</td>
                  <td data-testid="stat-runs7d-CANCELLED">{data.runs7d.CANCELLED}</td>
                  <td data-testid="stat-runs7d-INTERRUPTED">{data.runs7d.INTERRUPTED}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section>
            <h2>Lượt chạy gần nhất</h2>
            {data.recentRuns.length === 0 ? (
              <p data-testid="empty-recent-runs">Chưa có dữ liệu</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Mã</th>
                    <th>Dự án</th>
                    <th>Task</th>
                    <th>Trạng thái</th>
                    <th>Thời gian kết thúc</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentRuns.map((r) => (
                    <tr key={r.id} data-testid={`recent-run-${r.id}`}>
                      <td>
                        <Link href={`/runs/${r.id}`}>{r.id}</Link>
                      </td>
                      <td>{r.projectSlug}</td>
                      <td>#{r.taskNumber}</td>
                      <td>{r.status}</td>
                      <td>{r.finishedAt ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
