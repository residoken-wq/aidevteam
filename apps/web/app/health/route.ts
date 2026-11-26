/**
 * Liveness of the web container (used by deploy/deploy.sh). No dependencies, no details.
 * Overall readiness (database, migrations) is the api's /health/ready.
 */
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ status: "ok", checks: {} }, { headers: { "Cache-Control": "no-store" } });
}
