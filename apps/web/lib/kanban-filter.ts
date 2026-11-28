import type { Task } from "@aidevteam/contracts";

export interface KanbanFilters {
  priority?: string;
  agent?: string;
  q?: string;
}

/**
 * Filter tasks on client-side by priority, agent, and title keyword (q).
 * P3-04: client-side filtering for tasks (<= 500 tasks).
 */
export function filterKanbanTasks(tasks: Task[], filters: KanbanFilters): Task[] {
  const priority = filters.priority?.trim() || undefined;
  const agent = filters.agent?.trim() || undefined;
  const q = filters.q?.trim().toLowerCase() || undefined;

  if (!priority && !agent && !q) {
    return tasks;
  }

  return tasks.filter((t) => {
    // 1. Priority filter
    if (priority && t.priority !== priority) {
      return false;
    }

    // 2. Agent filter ("unassigned" / "none" matches tasks without agentSlug)
    if (agent) {
      if (agent === "unassigned" || agent === "none") {
        if (t.agentSlug) return false;
      } else if (t.agentSlug !== agent) {
        return false;
      }
    }

    // 3. Title keyword search (case-insensitive substring)
    if (q) {
      if (!t.title.toLowerCase().includes(q)) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Check if any filter (including epic and sprint) is active.
 */
export function hasActiveKanbanFilters(filters: {
  epic?: string;
  sprint?: string;
  priority?: string;
  agent?: string;
  q?: string;
}): boolean {
  return Boolean(
    filters.epic?.trim() ||
      filters.sprint?.trim() ||
      filters.priority?.trim() ||
      filters.agent?.trim() ||
      filters.q?.trim(),
  );
}

/**
 * Build URL search string for Kanban filters.
 */
export function buildKanbanQuery(
  filters: Record<string, string | number | undefined | null>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null) {
      const s = String(value).trim();
      if (s) {
        params.set(key, s);
      }
    }
  }
  return params.toString();
}
