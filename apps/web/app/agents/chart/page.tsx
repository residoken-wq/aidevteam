import type { Agent } from "@aidevteam/contracts";
import Link from "next/link";
import { apiGet, can, type Me } from "../../../lib/server-api";
import { OrgChart } from "./chart-view";

export const dynamic = "force-dynamic";

export default async function OrgChartPage() {
  const me = await apiGet<Me>("/auth/me");
  const data = await apiGet<{ items: Agent[] }>("/agents?archived=false&limit=100");
  const canWrite = can(me, "agent:write");
  const activeAgents = (data?.items ?? []).filter((a) => !a.archivedAt);

  return (
    <div>
      <p>
        <Link href="/agents">← Danh sách agent</Link>
      </p>
      <h1>Sơ đồ tổ chức {me?.activeOrg ? `— ${me.activeOrg.slug}` : ""}</h1>
      {data === null ? (
        <p role="status">Bạn chưa có quyền xem agent trong tổ chức này.</p>
      ) : (
        <OrgChart agents={activeAgents} canWrite={canWrite} />
      )}
    </div>
  );
}
