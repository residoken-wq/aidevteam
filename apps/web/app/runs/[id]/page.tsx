import type { Run } from "@aidevteam/contracts";
import { notFound } from "next/navigation";
import { canCancelRun, isValidRunId } from "../../../lib/runs";
import { apiGet, can, type Me } from "../../../lib/server-api";
import { RunDetail } from "./run-detail";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidRunId(id)) notFound();

  const me = await apiGet<Me>("/auth/me");
  if (!can(me, "run:read")) {
    return (
      <main>
        <p role="status">Bạn chưa có quyền xem lượt chạy này.</p>
      </main>
    );
  }

  const run = await apiGet<Run>(`/runs/${id}`);
  if (!run) notFound();

  const canCancel = canCancelRun(run.status, can(me, "dispatch:execute"));

  return <RunDetail run={run} canCancel={canCancel} />;
}
