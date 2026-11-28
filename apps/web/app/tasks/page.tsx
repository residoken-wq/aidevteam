import type { Agent, Project, ProjectStatsResponse, TaskSearchResponse } from "@aidevteam/contracts";
import { TASK_PRIORITIES, TASK_STATUSES } from "@aidevteam/contracts";
import Link from "next/link";
import { apiGet, can, type Me } from "../../lib/server-api";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TasksSearchPage({ searchParams }: PageProps) {
  const params = await searchParams;

  const q = typeof params.q === "string" ? params.q : "";
  const project = typeof params.project === "string" ? params.project : "";
  const agent = typeof params.agent === "string" ? params.agent : "";
  const priority = typeof params.priority === "string" ? params.priority : "";

  // Normalize status filter into string array
  let selectedStatuses: string[] = [];
  if (Array.isArray(params.status)) {
    selectedStatuses = params.status.flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
  } else if (typeof params.status === "string" && params.status) {
    selectedStatuses = params.status.split(",").map((s) => s.trim()).filter(Boolean);
  }

  const limit = typeof params.limit === "string" && !Number.isNaN(Number(params.limit)) ? Math.max(1, Math.min(100, Number(params.limit))) : 50;
  const offset = typeof params.offset === "string" && !Number.isNaN(Number(params.offset)) ? Math.max(0, Number(params.offset)) : 0;

  // Build backend search query URL
  const queryParts: string[] = [];
  if (q.trim()) queryParts.push(`q=${encodeURIComponent(q.trim())}`);
  if (project.trim()) queryParts.push(`project=${encodeURIComponent(project.trim())}`);
  if (agent.trim()) queryParts.push(`agent=${encodeURIComponent(agent.trim())}`);
  if (priority.trim()) queryParts.push(`priority=${encodeURIComponent(priority.trim())}`);
  for (const st of selectedStatuses) {
    queryParts.push(`status=${encodeURIComponent(st)}`);
  }
  queryParts.push(`limit=${limit}`);
  queryParts.push(`offset=${offset}`);

  const me = await apiGet<Me>("/auth/me");
  const canReadTask = can(me, "task:read");
  const canReadProject = can(me, "project:read");
  const canReadAgent = can(me, "agent:read");

  const [searchResults, statsResults, projectsList, agentsList] = await Promise.all([
    canReadTask ? apiGet<TaskSearchResponse>(`/tasks/search?${queryParts.join("&")}`) : null,
    canReadProject ? apiGet<ProjectStatsResponse>("/stats/projects") : null,
    canReadProject ? apiGet<{ items: Project[] }>("/projects") : null,
    canReadAgent ? apiGet<{ items: Agent[] }>("/agents") : null,
  ]);

  // Helper for pagination links preserving current search params
  const buildPageUrl = (newOffset: number) => {
    const pageParams = new URLSearchParams();
    if (q.trim()) pageParams.set("q", q.trim());
    if (project.trim()) pageParams.set("project", project.trim());
    if (agent.trim()) pageParams.set("agent", agent.trim());
    if (priority.trim()) pageParams.set("priority", priority.trim());
    for (const st of selectedStatuses) {
      pageParams.append("status", st);
    }
    pageParams.set("limit", String(limit));
    pageParams.set("offset", String(newOffset));
    return `/tasks?${pageParams.toString()}`;
  };

  const total = searchResults?.total ?? 0;
  const hasPrev = offset > 0;
  const prevOffset = Math.max(0, offset - limit);
  const hasNext = offset + limit < total;
  const nextOffset = offset + limit;

  return (
    <div>
      <p>
        <Link href="/">← Trang chủ</Link>
      </p>

      <h1>Tìm task {me?.activeOrg ? `— ${me.activeOrg.slug}` : ""}</h1>

      {/* 1. Khối thống kê theo project */}
      <section data-testid="project-stats-section" style={{ marginBottom: "2rem" }}>
        <h2>Thống kê task theo dự án</h2>
        {statsResults === null ? (
          <p role="status">Bạn chưa có quyền xem thống kê dự án.</p>
        ) : statsResults.items.length === 0 ? (
          <p>Chưa có dự án nào.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Dự án</th>
                <th scope="col">BACKLOG</th>
                <th scope="col">TODO</th>
                <th scope="col">IN_PROGRESS</th>
                <th scope="col">IN_REVIEW</th>
                <th scope="col">DONE</th>
                <th scope="col">CANCELLED</th>
                <th scope="col">Tổng</th>
              </tr>
            </thead>
            <tbody>
              {statsResults.items.map((ps) => (
                <tr key={ps.projectSlug} data-testid={`stats-row-${ps.projectSlug}`}>
                  <td>
                    <Link href={`/projects/${ps.projectSlug}/tasks`} title={`Xem Kanban dự án ${ps.projectName}`}>
                      {ps.projectName} ({ps.projectSlug})
                    </Link>
                  </td>
                  <td>{ps.counts.BACKLOG}</td>
                  <td>{ps.counts.TODO}</td>
                  <td>{ps.counts.IN_PROGRESS}</td>
                  <td>{ps.counts.IN_REVIEW}</td>
                  <td>{ps.counts.DONE}</td>
                  <td>{ps.counts.CANCELLED}</td>
                  <td>
                    <strong>{ps.total}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 2. Form lọc task */}
      <section style={{ marginBottom: "2rem" }}>
        <h2>Bộ lọc tìm kiếm</h2>
        <form method="GET" action="/tasks" role="search" aria-label="Tìm kiếm task" data-testid="task-search-form">
          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor="search-q" style={{ display: "block", fontWeight: "bold" }}>
              Từ khóa tiêu đề:
            </label>
            <input
              id="search-q"
              type="text"
              name="q"
              defaultValue={q}
              maxLength={100}
              placeholder="Nhập tiêu đề cần tìm..."
              style={{ width: "300px", padding: "0.25rem" }}
            />
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor="search-project" style={{ display: "block", fontWeight: "bold" }}>
              Dự án:
            </label>
            <select id="search-project" name="project" defaultValue={project} style={{ minWidth: "200px", padding: "0.25rem" }}>
              <option value="">Tất cả dự án</option>
              {projectsList?.items.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.name} ({p.slug})
                </option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor="search-agent" style={{ display: "block", fontWeight: "bold" }}>
              Agent:
            </label>
            <select id="search-agent" name="agent" defaultValue={agent} style={{ minWidth: "200px", padding: "0.25rem" }}>
              <option value="">Tất cả agent</option>
              <option value="none">Chưa phân công (none)</option>
              {agentsList?.items.map((a) => (
                <option key={a.slug} value={a.slug}>
                  {a.name} ({a.slug})
                </option>
              ))}
            </select>
          </div>

          <fieldset style={{ marginBottom: "1rem", border: "1px solid #ccc", padding: "0.5rem" }}>
            <legend style={{ fontWeight: "bold" }}>Trạng thái:</legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
              {TASK_STATUSES.map((st) => (
                <label key={st} htmlFor={`status-${st}`} style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                  <input
                    id={`status-${st}`}
                    type="checkbox"
                    name="status"
                    value={st}
                    defaultChecked={selectedStatuses.includes(st)}
                    data-testid={`status-checkbox-${st}`}
                  />
                  {st}
                </label>
              ))}
            </div>
          </fieldset>

          <div style={{ marginBottom: "1rem" }}>
            <label htmlFor="search-priority" style={{ display: "block", fontWeight: "bold" }}>
              Mức ưu tiên:
            </label>
            <select id="search-priority" name="priority" defaultValue={priority} style={{ minWidth: "150px", padding: "0.25rem" }}>
              <option value="">Tất cả</option>
              {TASK_PRIORITIES.map((pr) => (
                <option key={pr} value={pr}>
                  {pr}
                </option>
              ))}
            </select>
          </div>

          <div>
            <button type="submit" data-testid="search-submit-btn" style={{ padding: "0.4rem 1rem", marginRight: "1rem" }}>
              Lọc kết quả
            </button>
            <Link href="/tasks" data-testid="search-reset-link">
              Xóa bộ lọc
            </Link>
          </div>
        </form>
      </section>

      {/* 3. Bảng kết quả + phân trang */}
      <section data-testid="task-search-results">
        <h2>Kết quả tìm kiếm</h2>
        {searchResults === null ? (
          <p role="status">Bạn chưa có quyền tìm kiếm task trong tổ chức này.</p>
        ) : (
          <>
            <p data-testid="search-total-count">
              Tổng số task tìm thấy: <strong>{searchResults.total}</strong>
            </p>

            {searchResults.items.length === 0 ? (
              <p>Không tìm thấy task nào phù hợp.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th scope="col">Dự án</th>
                    <th scope="col">Mã</th>
                    <th scope="col">Tiêu đề</th>
                    <th scope="col">Trạng thái</th>
                    <th scope="col">Ưu tiên</th>
                    <th scope="col">Agent</th>
                    <th scope="col">Cập nhật</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.items.map((t) => (
                    <tr key={`${t.projectSlug}-${t.number}`} data-testid={`task-row-${t.projectSlug}-${t.number}`}>
                      <td>
                        <Link href={`/projects/${t.projectSlug}/tasks`}>{t.projectName}</Link>
                      </td>
                      <td>
                        <Link href={`/projects/${t.projectSlug}/tasks`} title={`Xem task #${t.number} trên Kanban`}>
                          #{t.number}
                        </Link>
                      </td>
                      <td>{t.title}</td>
                      <td>{t.status}</td>
                      <td>{t.priority}</td>
                      <td>{t.agentSlug ?? "—"}</td>
                      <td>{new Date(t.updatedAt).toLocaleString("vi-VN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Phân trang */}
            {total > limit ? (
              <nav aria-label="Phân trang kết quả tìm kiếm" style={{ marginTop: "1rem", display: "flex", gap: "1rem", alignItems: "center" }}>
                {hasPrev ? (
                  <Link href={buildPageUrl(prevOffset)} data-testid="prev-page-link">
                    ← Trang trước
                  </Link>
                ) : (
                  <span style={{ color: "#888" }}>← Trang trước</span>
                )}
                <span>
                  Hiển thị {offset + 1}–{Math.min(offset + limit, total)} trên {total}
                </span>
                {hasNext ? (
                  <Link href={buildPageUrl(nextOffset)} data-testid="next-page-link">
                    Trang sau →
                  </Link>
                ) : (
                  <span style={{ color: "#888" }}>Trang sau →</span>
                )}
              </nav>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
