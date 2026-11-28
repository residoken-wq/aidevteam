import type { Agent, ProviderAccount } from "@aidevteam/contracts";
import Link from "next/link";
import { apiGet, can, type Me } from "../../lib/server-api";
import { AgentRowActions, CreateAgentForm } from "./forms";

export const dynamic = "force-dynamic";

export default async function AgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const showArchived = (await searchParams).archived === "true";
  const me = await apiGet<Me>("/auth/me");
  const data = await apiGet<{ items: Agent[] }>(`/agents?archived=${showArchived ? "true" : "false"}&limit=100`);
  const canWrite = can(me, "agent:write");
  const accounts = canWrite
    ? ((await apiGet<{ items: ProviderAccount[] }>("/provider-accounts?limit=100"))?.items ?? [])
        .filter((a) => a.licenseStatus === "approved" && !a.archivedAt)
        .map((a) => a.slug)
    : [];
  const activeAgents = (data?.items ?? []).filter((a) => !a.archivedAt).map((a) => a.slug);

  return (
    <div>
      <p>
        <Link href="/">← Trang chủ</Link> · <Link href="/agents/chart">Sơ đồ tổ chức</Link>
      </p>
      <h1>Agent {me?.activeOrg ? `— ${me.activeOrg.slug}` : ""}</h1>
      {data === null ? (
        <p role="status">Bạn chưa có quyền xem agent trong tổ chức này.</p>
      ) : (
        <>
          {canWrite ? <CreateAgentForm accounts={accounts} managers={activeAgents} /> : null}
          <p>{showArchived ? <Link href="/agents">Ẩn mục đã lưu trữ</Link> : <Link href="/agents?archived=true">Hiện cả mục đã lưu trữ</Link>}</p>
          {data.items.length === 0 ? (
            <p>Chưa có agent nào.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Tên</th>
                  <th>Chức danh</th>
                  <th>Model</th>
                  <th>Tài khoản provider</th>
                  <th>Báo cáo cho</th>
                  <th>Trạng thái</th>
                  {canWrite ? <th>Thao tác</th> : null}
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a.slug} data-testid={`agent-${a.slug}`}>
                    <td>{a.slug}</td>
                    <td>{a.name}</td>
                    <td>{a.title ?? "—"}</td>
                    <td>{a.model ? <code>{a.model}</code> : "—"}</td>
                    <td>{a.providerAccountSlug ?? "—"}</td>
                    <td>{a.reportsToSlug ?? "—"}</td>
                    <td>{a.archivedAt ? "Đã lưu trữ" : a.enabled ? "Đang bật" : "Đã tắt"}</td>
                    {canWrite ? (
                      <td>
                        {a.archivedAt ? null : (
                          <AgentRowActions slug={a.slug} name={a.name} enabled={a.enabled} reportsTo={a.reportsToSlug} managers={activeAgents.filter((s) => s !== a.slug)} />
                        )}
                      </td>
                    ) : null}
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
