/** UUID v4 regex used to validate run ids before hitting the API. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidRunId(id: string): boolean {
  return UUID_RE.test(id);
}

/**
 * P4-07 / P4b: A run is only cancellable when in QUEUED or RUNNING status
 * and the actor holds the dispatch:execute permission.
 */
export function canCancelRun(status: string, hasDispatchPermission: boolean): boolean {
  return hasDispatchPermission && (status === "QUEUED" || status === "RUNNING");
}
