import { Inject, Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { MockOutputSchema, redact, type RunStatus } from "@aidevteam/contracts";
import type { Pool } from "@aidevteam/db";
import { writeAudit } from "../audit";
import type { AppConfig } from "../config";
import { APP_CONFIG, DB_POOL, MOCK_RUNNER } from "../tokens";
import type { MockRunner } from "./mock-runner";

@Injectable()
export class RunWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private runningTick = false;

  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(MOCK_RUNNER) private readonly mockRunner: MockRunner,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      // Interrupted recovery on startup: RUNNING -> INTERRUPTED (STATE_MACHINES §2, CLAUDE.md §6.2-6)
      const interrupted = await this.pool.query<{ id: string; org_id: string; task_number: number }>(
        `UPDATE agent_runs r
            SET status = 'INTERRUPTED',
                finished_at = now(),
                error_code = 'interrupted'
           FROM tasks t
          WHERE r.task_id = t.id AND r.status = 'RUNNING'
          RETURNING r.id, r.org_id, t.number AS task_number`,
      );
      for (const row of interrupted.rows) {
        await writeAudit(this.pool, {
          orgId: row.org_id,
          action: "run.finished",
          targetType: "agent_run",
          targetId: row.id,
          metadata: {
            runId: row.id,
            taskNumber: row.task_number,
            from: "RUNNING",
            to: "INTERRUPTED",
          },
        });
      }
    } catch {
      // Database may be down or unreachable at bootstrap (e.g. unit testing /health/live)
    }

    if (this.config.mockWorkerEnabled) {
      this.timer = setInterval(() => {
        if (!this.runningTick) {
          this.runningTick = true;
          this.tick()
            .catch(() => undefined)
            .finally(() => {
              this.runningTick = false;
            });
        }
      }, 1000);
    }
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<{ processed: boolean; runId?: string; status?: RunStatus }> {
    const client = await this.pool.connect();
    let job: { id: string; org_id: string; task_id: string; attempt: number; task_number: number };
    try {
      await client.query("BEGIN");
      // Documentation: PostgreSQL 16 "The Locking Clause"
      // https://www.postgresql.org/docs/16/sql-select.html#SQL-FOR-UPDATE-SHARE
      // SELECT ... FOR UPDATE SKIP LOCKED acquires an exclusive row-level lock on the selected row
      // and skips any rows already locked by concurrent transactions.
      const sel = await client.query<{ id: string; org_id: string; task_id: string; attempt: number; task_number: number }>(
        `SELECT r.id, r.org_id, r.task_id, r.attempt, t.number AS task_number
           FROM agent_runs r
           JOIN tasks t ON t.id = r.task_id AND t.org_id = r.org_id
          WHERE r.status = 'QUEUED'
          ORDER BY r.queued_at ASC
          LIMIT 1
          FOR UPDATE OF r SKIP LOCKED`,
      );
      if (sel.rows.length === 0) {
        await client.query("ROLLBACK");
        return { processed: false };
      }
      job = sel.rows[0]!;
      await client.query(
        `UPDATE agent_runs
            SET status = 'RUNNING', started_at = now()
          WHERE id = $1 AND status = 'QUEUED'`,
        [job.id],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }

    let runnerResult: unknown;
    let runnerFailed = false;
    let errorCode: string | null = null;
    let summary = "";
    let log = "";

    const timeoutMs = this.config.runnerTimeoutMs ?? 30_000;
    let timeoutTimer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutTimer = setTimeout(() => reject(new Error("RUNNER_TIMEOUT")), timeoutMs);
    });

    try {
      const runnerPromise = this.mockRunner.run({ runId: job.id, attempt: job.attempt });
      runnerResult = await Promise.race([runnerPromise, timeoutPromise]);
    } catch (err: unknown) {
      runnerFailed = true;
      if (err instanceof Error && err.message === "RUNNER_TIMEOUT") {
        errorCode = "timeout";
        summary = "Run timed out";
        log = "Execution exceeded configured timeout";
      } else {
        errorCode = "runner_error";
        summary = err instanceof Error ? err.message : String(err);
        log = err instanceof Error && err.stack ? err.stack : summary;
      }
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }

    if (!runnerFailed) {
      const parsed = MockOutputSchema.safeParse(runnerResult);
      if (!parsed.success) {
        runnerFailed = true;
        errorCode = "invalid_output";
        summary = "Output failed schema validation";
        log = typeof runnerResult === "object" && runnerResult !== null ? JSON.stringify(runnerResult) : String(runnerResult);
      } else if (parsed.data.status !== "SUCCESS") {
        runnerFailed = true;
        errorCode = "run_failed";
        summary = parsed.data.summary;
        log = JSON.stringify(parsed.data);
      } else {
        summary = parsed.data.summary;
        log = JSON.stringify(parsed.data);
      }
    }

    const finalStatus: RunStatus = runnerFailed ? "FAILED" : "SUCCEEDED";
    const redactedSummary = redact(summary).slice(0, 2000);
    const redactedLog = redact(log).slice(0, 65536);

    const updateRes = await this.pool.query<{ id: string }>(
      `UPDATE agent_runs
          SET status = $2,
              finished_at = now(),
              output_summary = $3,
              log = $4,
              error_code = $5
        WHERE id = $1 AND status = 'RUNNING'
       RETURNING id`,
      [job.id, finalStatus, redactedSummary, redactedLog, errorCode],
    );

    if (updateRes.rowCount && updateRes.rowCount > 0) {
      await writeAudit(this.pool, {
        orgId: job.org_id,
        action: "run.finished",
        targetType: "agent_run",
        targetId: job.id,
        metadata: {
          runId: job.id,
          taskNumber: job.task_number,
          from: "RUNNING",
          to: finalStatus,
        },
      });
      return { processed: true, runId: job.id, status: finalStatus };
    }

    return { processed: true, runId: job.id, status: "CANCELLED" };
  }
}
