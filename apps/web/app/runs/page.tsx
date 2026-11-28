import type { RunsResponse } from "@aidevteam/contracts";
import { apiGet, can, type Me } from "../../lib/server-api";
import { RunsList } from "./runs-list";

export const dynamic = "force-dynamic";

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const me = await apiGet<Me>("/auth/me");
  if (!can(me, "run:read")) {
    return (
      <div>
        <h1>Lượt chạy</h1>
        <p role="status">Bạn chưa có quyền xem danh sách lượt chạy.</p>
      </div>
    );
  }

  const sp = await searchParams;

  // Build query string for apiGet
  const qs = new URLSearchParams();
  if (sp.status) {
    if (Array.isArray(sp.status)) {
      for (const s of sp.status) qs.append("status", s);
    } else {
      qs.set("status", sp.status);
    }
  }
  if (typeof sp.project === "string" && sp.project) {
    qs.set("project", sp.project);
  }
  if (typeof sp.worker === "string" && sp.worker) {
    qs.set("worker", sp.worker);
  }
  if (typeof sp.limit === "string" && sp.limit) {
    qs.set("limit", sp.limit);
  }
  if (typeof sp.offset === "string" && sp.offset) {
    qs.set("offset", sp.offset);
  }

  const queryString = qs.toString();
  const runsData = await apiGet<RunsResponse>(`/runs${queryString ? `?${queryString}` : ""}`);

  const canCancel = can(me, "dispatch:execute");

  return (
    <div>
      <h1>Lượt chạy</h1>
      <RunsList
        runsData={runsData}
        canCancel={canCancel}
        initialFilters={{
          status: typeof sp.status === "string" ? sp.status : Array.isArray(sp.status) ? sp.status.join(",") : "",
          project: typeof sp.project === "string" ? sp.project : "",
          worker: typeof sp.worker === "string" ? sp.worker : "",
        }}
      />
    </div>
  );
}
