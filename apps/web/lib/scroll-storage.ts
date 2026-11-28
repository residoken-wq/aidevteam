export interface ScrollPosition {
  scrollY: number;
  scrollX: number;
  boardScrollLeft: number;
}

/**
 * Storage key for preserving scroll position per project + query.
 * Normalizes query string by stripping `task` parameter so opening/closing
 * drawer does not change the scroll key.
 */
export function getScrollStorageKey(projectSlug: string, query: string): string {
  const cleanQuery = query.startsWith("?") ? query.slice(1) : query;
  const sp = new URLSearchParams(cleanQuery);
  sp.delete("task");
  const sorted = new URLSearchParams();
  const keys = Array.from(sp.keys()).sort();
  for (const k of keys) {
    const vals = sp.getAll(k);
    for (const v of vals) {
      if (v.trim()) {
        sorted.append(k, v.trim());
      }
    }
  }
  const norm = sorted.toString();
  return `kanban_scroll:${projectSlug}${norm ? `?${norm}` : ""}`;
}

/**
 * Save scroll position to sessionStorage. Wrapped in try/catch (safe in private mode / restricted environments).
 */
export function saveScrollPosition(
  projectSlug: string,
  query: string,
  pos: ScrollPosition,
): boolean {
  if (typeof window === "undefined" || !window.sessionStorage) return false;
  try {
    const key = getScrollStorageKey(projectSlug, query);
    window.sessionStorage.setItem(key, JSON.stringify(pos));
    return true;
  } catch {
    return false;
  }
}

/**
 * Load scroll position from sessionStorage. Wrapped in try/catch.
 */
export function loadScrollPosition(
  projectSlug: string,
  query: string,
): ScrollPosition | null {
  if (typeof window === "undefined" || !window.sessionStorage) return null;
  try {
    const key = getScrollStorageKey(projectSlug, query);
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.scrollY === "number" &&
      typeof parsed?.scrollX === "number" &&
      typeof parsed?.boardScrollLeft === "number"
    ) {
      return {
        scrollY: parsed.scrollY,
        scrollX: parsed.scrollX,
        boardScrollLeft: parsed.boardScrollLeft,
      };
    }
  } catch {
    // Ignore errors
  }
  return null;
}

/**
 * Clear saved scroll position.
 */
export function clearScrollPosition(projectSlug: string, query: string): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  try {
    const key = getScrollStorageKey(projectSlug, query);
    window.sessionStorage.removeItem(key);
  } catch {
    // Ignore
  }
}
