import assert from "node:assert/strict";
import { test } from "node:test";
import { summarise } from "./progress.mjs";

const t = (id, phase, rel, status) => ({ id, labels: [rel, `phase:${phase}`], status });

test("counts only MERGED/DONE as done, excludes removed/optional/impossible items", () => {
  const s = summarise([
    t("A", 0, "release-0.1", "DONE"),
    t("B", 1, "release-0.1", "MERGED"),
    t("C", 1, "release-0.1", "PR_OPEN"),
    t("D", 1, "post-0.1", "REMOVED (O-12)"),
    t("E", 4, "post-0.1", "OPTIONAL"),
    t("F", 6, "post-0.1", "TODO"),
  ]);
  assert.deepEqual([s.release01.tasksDone, s.release01.tasksTotal, s.release01.phasesDone, s.release01.phasesTotal], [2, 3, 1, 2]);
  assert.deepEqual(s.release01.phases["1"].open, ["C"]);
  assert.deepEqual([s.backlog.tasksDone, s.backlog.tasksTotal, s.backlog.phasesTotal], [2, 4, 3]);
});
