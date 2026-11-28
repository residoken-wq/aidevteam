import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  DispatchRunSchema,
  redact,
  RunListQuerySchema,
  type Run,
  type RunStatus,
} from "@aidevteam/contracts";
import type { Pool } from "@aidevteam/db";
import type { Request } from "express";
import { writeAudit } from "../audit";
import { getAuth, getOrg } from "../rbac/auth-context";
import { RequirePermission } from "../rbac/decorators";
import { verifyProjectScope } from "../rbac/project-scope";
import { DB_POOL } from "../tokens";
import { parseOr422 } from "../validation";

interface RunRow {
  id: string;
  project_slug: string;
  task_number: number;
  worker_slug: string;
  status: RunStatus;
  attempt: number;
  queued_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  output_summary: string | null;
  log: string | null;
  error_code: string | null;
}

const SELECT_RUN = `SELECT r.id, p.slug AS project_slug, t.number AS task_number, w.slug AS worker_slug,
                           r.status, r.attempt, r.queued_at, r.started_at, r.finished_at,
                           r.output_summary, r.log, r.error_code
                      FROM agent_runs r
                      JOIN tasks t ON t.id = r.task_id AND t.org_id = r.org_id
                      JOIN projects p ON p.id = t.project_id AND p.org_id = t.org_id
                      JOIN workers w ON w.id = r.worker_id AND w.org_id = r.org_id`;

const toDto = (r: RunRow): Run => ({
  id: r.id,
  projectSlug: r.project_slug,
  taskNumber: r.task_number,
  workerSlug: r.worker_slug,
  status: r.status,
  attempt: r.attempt,
  queuedAt: r.queued_at.toISOString(),
  startedAt: r.started_at ? r.started_at.toISOString() : null,
  finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
  outputSummary: r.output_summary ? redact(r.output_summary) : null,
  log: r.log ? redact(r.log) : null,
  errorCode: r.error_code,
});

const NUMBER_RE = /^[1-9][0-9]{0,8}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Controller()
export class RunsController {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  @RequirePermission("dispatch:execute")
  @Post("projects/:projectSlug/tasks/:number/dispatch")
  @HttpCode(201)
  async dispatch(
    @Req() req: Request,
    @Param("projectSlug") projectSlug: string,
    @Param("number") numberStr: string,
    @Body() body: unknown,
  ): Promise<Run> {
    if (!NUMBER_RE.test(numberStr)) throw new NotFoundException({ statusCode: 404, message: "task_not_found" });
    const number = Number(numberStr);
    const input = parseOr422(DispatchRunSchema, body);
    const org = getOrg(req);
    const auth = getAuth(req);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Advisory lock per org to serialize queue checks and worker concurrency
      await client.query("SELECT pg_advisory_xact_lock(hashtext('runs:' || $1::text))", [org.orgId]);

      // Check project in org and verify project-scope
      const projectScope = await verifyProjectScope({
        pool: client,
        orgId: org.orgId,
        userId: auth.userId,
        roles: org.roles,
        requiredAccess: "write",
        projectSlug,
      });

      const projRes = await client.query<{ id: string }>(
        "SELECT id FROM projects WHERE org_id = $1 AND id = $2 AND archived_at IS NULL",
        [org.orgId, projectScope.id],
      );
      if (!projRes.rows[0]) throw new NotFoundException({ statusCode: 404, message: "project_not_found" });
      const projectId = projRes.rows[0].id;

      // Check task in org
      const taskRes = await client.query<{ id: string; status: string; number: number; agent_id: string | null }>(
        "SELECT id, status, number, agent_id FROM tasks WHERE org_id = $1 AND project_id = $2 AND number = $3",
        [org.orgId, projectId, number],
      );
      if (!taskRes.rows[0]) throw new NotFoundException({ statusCode: 404, message: "task_not_found" });
      const task = taskRes.rows[0];

      // Task must be in TODO or IN_PROGRESS
      if (task.status !== "TODO" && task.status !== "IN_PROGRESS") {
        throw new ConflictException({ statusCode: 409, message: "task_not_dispatchable" });
      }

      // Check worker in org
      const workerRes = await client.query<{ id: string; enabled: boolean; type: string; project_id: string | null }>(
        "SELECT id, enabled, type, project_id FROM workers WHERE org_id = $1 AND slug = $2 AND archived_at IS NULL",
        [org.orgId, input.workerSlug],
      );
      if (!workerRes.rows[0]) throw new NotFoundException({ statusCode: 404, message: "worker_not_found" });
      const worker = workerRes.rows[0];

      if (!worker.enabled || worker.type !== "mock") {
        throw new ConflictException({ statusCode: 409, message: "worker_not_dispatchable" });
      }

      if (worker.project_id !== null && worker.project_id !== projectId) {
        throw new ConflictException({ statusCode: 409, message: "worker_project_mismatch" });
      }

      if (task.agent_id !== null) {
        const agentRes = await client.query<{
          id: string;
          enabled: boolean;
          archived_at: Date | null;
          provider_account_id: string | null;
          pa_archived_at: Date | null;
          pa_license_status: string | null;
        }>(
          `SELECT a.id, a.enabled, a.archived_at, a.provider_account_id,
                  pa.archived_at AS pa_archived_at, pa.license_status AS pa_license_status
             FROM agents a
             LEFT JOIN provider_accounts pa ON pa.id = a.provider_account_id AND pa.org_id = a.org_id
            WHERE a.id = $1 AND a.org_id = $2`,
          [task.agent_id, org.orgId],
        );
        const agent = agentRes.rows[0];
        if (!agent || agent.archived_at !== null || !agent.enabled) {
          throw new ConflictException({ statusCode: 409, message: "agent_not_dispatchable" });
        }
        if (agent.provider_account_id !== null) {
          if (agent.pa_archived_at !== null || agent.pa_license_status !== "approved") {
            throw new ConflictException({ statusCode: 409, message: "provider_account_not_licensed" });
          }
        }
      }

      // Check org queue depth > 20 QUEUED -> 429
      const queueRes = await client.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM agent_runs WHERE org_id = $1 AND status = 'QUEUED'",
        [org.orgId],
      );
      if (queueRes.rows[0] && queueRes.rows[0].count >= 20) {
        throw new HttpException({ statusCode: 429, message: "queue_full" }, HttpStatus.TOO_MANY_REQUESTS);
      }

      // Check worker busy (has QUEUED or RUNNING run)
      const busyRes = await client.query<{ id: string }>(
        "SELECT id FROM agent_runs WHERE org_id = $1 AND worker_id = $2 AND status IN ('QUEUED', 'RUNNING') LIMIT 1",
        [org.orgId, worker.id],
      );
      if (busyRes.rows.length > 0) {
        throw new ConflictException({ statusCode: 409, message: "worker_busy" });
      }

      // Next attempt for task
      const attemptRes = await client.query<{ next_attempt: number }>(
        "SELECT COALESCE(MAX(attempt), 0) + 1 AS next_attempt FROM agent_runs WHERE org_id = $1 AND task_id = $2",
        [org.orgId, task.id],
      );
      const attempt = attemptRes.rows[0]?.next_attempt ?? 1;

      // Insert run
      const insertRes = await client.query<{ id: string }>(
        `INSERT INTO agent_runs (org_id, task_id, worker_id, status, attempt, created_by_user_id)
         VALUES ($1, $2, $3, 'QUEUED', $4, $5)
         RETURNING id`,
        [org.orgId, task.id, worker.id, attempt, auth.userId],
      );
      const runId = insertRes.rows[0]!.id;

      const fetchRes = await client.query<RunRow>(
        `${SELECT_RUN} WHERE r.id = $1 AND r.org_id = $2`,
        [runId, org.orgId],
      );
      const row = fetchRes.rows[0]!;

      await writeAudit(client as unknown as Pool, {
        orgId: org.orgId,
        actorUserId: auth.userId,
        actorGithubUserId: auth.githubUserId,
        action: "run.dispatched",
        targetType: "agent_run",
        targetId: row.id,
        metadata: {
          runId: row.id,
          taskNumber: row.task_number,
          from: null,
          to: "QUEUED",
        },
      });

      await client.query("COMMIT");
      return toDto(row);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  @RequirePermission("run:read")
  @Get("projects/:projectSlug/tasks/:number/runs")
  async listForTask(
    @Req() req: Request,
    @Param("projectSlug") projectSlug: string,
    @Param("number") numberStr: string,
    @Query() query: unknown,
  ): Promise<{ items: Run[]; limit: number; offset: number }> {
    if (!NUMBER_RE.test(numberStr)) throw new NotFoundException({ statusCode: 404, message: "task_not_found" });
    const number = Number(numberStr);
    const q = parseOr422(RunListQuerySchema, query);
    const org = getOrg(req);
    const auth = getAuth(req);

    await verifyProjectScope({
      pool: this.pool,
      orgId: org.orgId,
      userId: auth.userId,
      roles: org.roles,
      requiredAccess: "read",
      projectSlug,
    });

    // Verify project and task exist in org
    const taskRes = await this.pool.query<{ id: string }>(
      `SELECT t.id
         FROM tasks t
         JOIN projects p ON p.id = t.project_id AND p.org_id = t.org_id
        WHERE t.org_id = $1 AND p.slug = $2 AND t.number = $3`,
      [org.orgId, projectSlug, number],
    );
    if (!taskRes.rows[0]) throw new NotFoundException({ statusCode: 404, message: "task_not_found" });
    const taskId = taskRes.rows[0].id;

    const r = await this.pool.query<RunRow>(
      `${SELECT_RUN}
        WHERE r.org_id = $1 AND r.task_id = $2 AND ($3::text IS NULL OR r.status = $3)
        ORDER BY r.queued_at DESC, r.id DESC
        LIMIT $4 OFFSET $5`,
      [org.orgId, taskId, q.status ?? null, q.limit, q.offset],
    );

    return { items: r.rows.map(toDto), limit: q.limit, offset: q.offset };
  }

  @RequirePermission("run:read")
  @Get("runs/:id")
  async getRun(@Req() req: Request, @Param("id") id: string): Promise<Run> {
    if (!UUID_RE.test(id)) throw new NotFoundException({ statusCode: 404, message: "run_not_found" });
    const org = getOrg(req);
    const auth = getAuth(req);

    const r = await this.pool.query<RunRow & { project_id: string }>(
      `SELECT r.id, p.id AS project_id, p.slug AS project_slug, t.number AS task_number, w.slug AS worker_slug,
              r.status, r.attempt, r.queued_at, r.started_at, r.finished_at,
              r.output_summary, r.log, r.error_code
         FROM agent_runs r
         JOIN tasks t ON t.id = r.task_id AND t.org_id = r.org_id
         JOIN projects p ON p.id = t.project_id AND p.org_id = t.org_id
         JOIN workers w ON w.id = r.worker_id AND w.org_id = r.org_id
        WHERE r.org_id = $1 AND r.id = $2`,
      [org.orgId, id],
    );
    if (!r.rows[0]) throw new NotFoundException({ statusCode: 404, message: "run_not_found" });

    await verifyProjectScope({
      pool: this.pool,
      orgId: org.orgId,
      userId: auth.userId,
      roles: org.roles,
      requiredAccess: "read",
      projectId: r.rows[0].project_id,
    });

    return toDto(r.rows[0]);
  }

  @RequirePermission("dispatch:execute")
  @HttpCode(200)
  @Post("runs/:id/cancel")
  async cancel(@Req() req: Request, @Param("id") id: string): Promise<Run> {
    if (!UUID_RE.test(id)) throw new NotFoundException({ statusCode: 404, message: "run_not_found" });
    const org = getOrg(req);
    const auth = getAuth(req);

    // Verify run exists in org
    const existing = await this.pool.query<{ id: string; status: string; task_number: number; project_id: string }>(
      `SELECT r.id, r.status, t.number AS task_number, p.id AS project_id
         FROM agent_runs r
         JOIN tasks t ON t.id = r.task_id AND t.org_id = r.org_id
         JOIN projects p ON p.id = t.project_id AND p.org_id = t.org_id
        WHERE r.org_id = $1 AND r.id = $2`,
      [org.orgId, id],
    );
    if (!existing.rows[0]) throw new NotFoundException({ statusCode: 404, message: "run_not_found" });
    const prev = existing.rows[0];

    await verifyProjectScope({
      pool: this.pool,
      orgId: org.orgId,
      userId: auth.userId,
      roles: org.roles,
      requiredAccess: "write",
      projectId: prev.project_id,
    });

    if (prev.status !== "QUEUED" && prev.status !== "RUNNING") {
      throw new ConflictException({ statusCode: 409, message: "run_not_cancellable" });
    }

    const updateRes = await this.pool.query<{ id: string }>(
      `UPDATE agent_runs
          SET status = 'CANCELLED', finished_at = now()
        WHERE org_id = $1 AND id = $2 AND status IN ('QUEUED', 'RUNNING')
       RETURNING id`,
      [org.orgId, id],
    );
    if (updateRes.rowCount === 0) {
      throw new ConflictException({ statusCode: 409, message: "run_not_cancellable" });
    }

    const fetchRes = await this.pool.query<RunRow>(
      `${SELECT_RUN} WHERE r.id = $1 AND r.org_id = $2`,
      [id, org.orgId],
    );
    const row = fetchRes.rows[0]!;

    await writeAudit(this.pool, {
      orgId: org.orgId,
      actorUserId: auth.userId,
      actorGithubUserId: auth.githubUserId,
      action: "run.cancelled",
      targetType: "agent_run",
      targetId: row.id,
      metadata: {
        runId: row.id,
        taskNumber: row.task_number,
        from: prev.status,
        to: "CANCELLED",
      },
    });

    return toDto(row);
  }
}
