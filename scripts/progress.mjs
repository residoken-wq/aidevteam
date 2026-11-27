#!/usr/bin/env node
/**
 * Progress report from docs/backlog/issues-import.json (single source of truth for task status).
 * Done = status MERGED or DONE (merged after human review). PR_OPEN / TODO / IN_PROGRESS are not done.
 * Usage: node scripts/progress.mjs [--json]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const DONE = new Set(["MERGED", "DONE"]);
/** Not counted in totals (removed, optional or impossible on the current plan). */
export const EXCLUDED = new Set(["REMOVED (O-12)", "OPTIONAL", "NOT AVAILABLE ON PLAN"]);

const phaseOf = (t) => (t.labels.find((l) => l.startsWith("phase:")) ?? "phase:?").slice(6);
const releaseOf = (t) => (t.labels.includes("release-0.1") ? "release-0.1" : t.labels.includes("post-0.1") ? "post-0.1" : "?");

export function summarise(items) {
  const scope = (filter) => {
    const tasks = items.filter((t) => filter(t) && !EXCLUDED.has(t.status));
    const phases = new Map();
    for (const t of tasks) {
      const p = phases.get(phaseOf(t)) ?? { total: 0, done: 0, open: [] };
      p.total++;
      if (DONE.has(t.status)) p.done++;
      else p.open.push(t.id);
      phases.set(phaseOf(t), p);
    }
    const ordered = [...phases.entries()].sort((a, b) => Number(a[0]) - Number(b[0]));
    return {
      tasksTotal: tasks.length,
      tasksDone: tasks.filter((t) => DONE.has(t.status)).length,
      phasesTotal: ordered.length,
      phasesDone: ordered.filter(([, p]) => p.done === p.total).length,
      phases: Object.fromEntries(ordered),
    };
  };
  return { release01: scope((t) => releaseOf(t) === "release-0.1"), backlog: scope(() => true) };
}

function format(s) {
  const line = (name, x) =>
    `${name}: Phase xong ${x.phasesDone}/${x.phasesTotal} · Task xong ${x.tasksDone}/${x.tasksTotal} (${Math.round((100 * x.tasksDone) / Math.max(1, x.tasksTotal))}%)`;
  const open = Object.entries(s.release01.phases)
    .filter(([, p]) => p.open.length)
    .map(([ph, p]) => `  Phase ${ph}: còn ${p.open.join(", ")}`)
    .join("\n");
  return `${line("Release 0.1", s.release01)}\n${line("Toàn backlog", s.backlog)}\nCòn lại trong Release 0.1:\n${open || "  (không còn)"}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { items } = JSON.parse(readFileSync(path.join(root, "docs/backlog/issues-import.json"), "utf8"));
  const s = summarise(items);
  process.stdout.write(`${process.argv.includes("--json") ? JSON.stringify(s, null, 2) : format(s)}\n`);
}
