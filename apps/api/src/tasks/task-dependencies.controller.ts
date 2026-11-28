import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import {
  TaskDependencyChangeSchema,
  type TaskDependencies,
  type TaskDependencyResult,
} from "@aidevteam/contracts";
import type { Pool } from "@aidevteam/db";
import type { Request } from "express";
import { writeAudit } from "../audit";
import { getAuth, getOrg } from "../rbac/auth-context";
import { RequirePermission } from "../rbac/decorators";
import { verifyProjectScope } from "../rbac/project-scope";
import { DB_POOL } from "../tokens";
import { parseOr422 } from "../validation";

const NUMBER_RE = /^[1-9][0-9]{0,8}$/;

interface TaskRow {
  id: string;
  number: number;
  status: string;
}

interface DepRow {
  number: number;
  title: string;
  status: "BACKLOG" | "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED";
}

@Controller("projects/:projectSlug/tasks/:number/dependencies")
export class TaskDependenciesController {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  @RequirePermission("task:read")
  @Get()
  async getDependencies(
    @Req() req: Request,
    @Param("projectSlug") projectSlug: string,
    @Param("number") numberStr: string,
  ): Promise<TaskDependencies> {
    if (!NUMBER_RE.test(numberStr)) throw new NotFoundException({ statusCode: 404, message: "task_not_found" });
    const number = Number(numberStr);
    const org = getOrg(req);
    const auth = getAuth(req);

    const project = await verifyProjectScope({
      pool: this.pool,
      orgId: org.orgId,
      userId: auth.userId,
      roles: org.roles,
      requiredAccess: "read",
      projectSlug,
    });

    const taskRes = await this.pool.query<TaskRow>(
      "SELECT id, number, status FROM tasks WHERE org_id = $1 AND project_id = $2 AND number = $3",
      [org.orgId, project.id, number],
    );
    if (!taskRes.rows[0]) throw new NotFoundException({ statusCode: 404, message: "task_not_found" });
    const task = taskRes.rows[0];

    const dependsOnRes = await this.pool.query<DepRow>(
      `SELECT t.number, t.title, t.status
         FROM task_dependencies td
         JOIN tasks t ON t.id = td.depends_on_task_id
        WHERE td.org_id = $1 AND td.project_id = $2 AND td.task_id = $3
        ORDER BY t.number ASC`,
      [org.orgId, project.id, task.id],
    );

    const dependentsRes = await this.pool.query<DepRow>(
      `SELECT t.number, t.title, t.status
         FROM task_dependencies td
         JOIN tasks t ON t.id = td.task_id
        WHERE td.org_id = $1 AND td.project_id = $2 AND td.depends_on_task_id = $3
        ORDER BY t.number ASC`,
      [org.orgId, project.id, task.id],
    );

    const dependsOn = dependsOnRes.rows;
    const blockedBy = dependsOn.filter((t) => t.status !== "DONE");
    const dependents = dependentsRes.rows;

    return {
      dependsOn,
      blockedBy,
      dependents,
    };
  }

  @RequirePermission("task:write")
  @Post()
  @HttpCode(200)
  async addDependency(
    @Req() req: Request,
    @Param("projectSlug") projectSlug: string,
    @Param("number") numberStr: string,
    @Body() body: unknown,
  ): Promise<TaskDependencyResult> {
    if (!NUMBER_RE.test(numberStr)) throw new NotFoundException({ statusCode: 404, message: "task_not_found" });
    const number = Number(numberStr);
    const input = parseOr422(TaskDependencyChangeSchema, body);
    const org = getOrg(req);
    const auth = getAuth(req);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const project = await verifyProjectScope({
        pool: client,
        orgId: org.orgId,
        userId: auth.userId,
        roles: org.roles,
        requiredAccess: "write",
        projectSlug,
      });

      const pArchived = await client.query<{ archived: boolean }>(
        "SELECT archived_at IS NOT NULL AS archived FROM projects WHERE org_id = $1 AND id = $2",
        [org.orgId, project.id],
      );
      if (pArchived.rows[0]?.archived) {
        throw new ConflictException({ statusCode: 409, message: "project_archived" });
      }

      await client.query("SELECT pg_advisory_xact_lock(hashtext('task_dependencies:' || $1::text))", [project.id]);

      const targetRes = await client.query<TaskRow>(
        "SELECT id, number, status FROM tasks WHERE org_id = $1 AND project_id = $2 AND number = $3",
        [org.orgId, project.id, number],
      );
      if (!targetRes.rows[0]) throw new NotFoundException({ statusCode: 404, message: "task_not_found" });
      const targetTask = targetRes.rows[0];

      if (targetTask.status === "DONE" || targetTask.status === "CANCELLED") {
        throw new ConflictException({ statusCode: 409, message: "task_closed" });
      }

      const depRes = await client.query<TaskRow>(
        "SELECT id, number, status FROM tasks WHERE org_id = $1 AND project_id = $2 AND number = $3",
        [org.orgId, project.id, input.dependsOn],
      );
      if (!depRes.rows[0]) throw new NotFoundException({ statusCode: 404, message: "task_not_found" });
      const dependsOnTask = depRes.rows[0];

      if (targetTask.id === dependsOnTask.id) {
        throw new ConflictException({ statusCode: 409, message: "dependency_cycle" });
      }

      const cycleCheck = await client.query(
        `WITH RECURSIVE path AS (
           SELECT depends_on_task_id AS next_task_id
             FROM task_dependencies
            WHERE project_id = $1 AND task_id = $2
           UNION
           SELECT td.depends_on_task_id
             FROM task_dependencies td
             JOIN path p ON td.task_id = p.next_task_id
            WHERE td.project_id = $1
         )
         SELECT 1 FROM path WHERE next_task_id = $3 LIMIT 1`,
        [project.id, dependsOnTask.id, targetTask.id],
      );
      if ((cycleCheck.rowCount ?? 0) > 0) {
        throw new ConflictException({ statusCode: 409, message: "dependency_cycle" });
      }

      const insertRes = await client.query(
        `INSERT INTO task_dependencies (org_id, project_id, task_id, depends_on_task_id, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (task_id, depends_on_task_id) DO NOTHING
         RETURNING task_id`,
        [org.orgId, project.id, targetTask.id, dependsOnTask.id, auth.userId],
      );

      const changed = insertRes.rowCount === 1;

      if (changed) {
        await writeAudit(client as unknown as Pool, {
          action: "task.dependency_added",
          orgId: org.orgId,
          actorUserId: auth.userId,
          actorGithubUserId: auth.githubUserId,
          targetType: "task",
          targetId: targetTask.id,
          metadata: {
            number: targetTask.number,
            dependsOn: dependsOnTask.number,
          },
        });
      }

      await client.query("COMMIT");
      return { changed };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  @RequirePermission("task:write")
  @Delete()
  @HttpCode(200)
  async removeDependency(
    @Req() req: Request,
    @Param("projectSlug") projectSlug: string,
    @Param("number") numberStr: string,
    @Body() body: unknown,
  ): Promise<TaskDependencyResult> {
    if (!NUMBER_RE.test(numberStr)) throw new NotFoundException({ statusCode: 404, message: "task_not_found" });
    const number = Number(numberStr);
    const input = parseOr422(TaskDependencyChangeSchema, body);
    const org = getOrg(req);
    const auth = getAuth(req);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const project = await verifyProjectScope({
        pool: client,
        orgId: org.orgId,
        userId: auth.userId,
        roles: org.roles,
        requiredAccess: "write",
        projectSlug,
      });

      const pArchived = await client.query<{ archived: boolean }>(
        "SELECT archived_at IS NOT NULL AS archived FROM projects WHERE org_id = $1 AND id = $2",
        [org.orgId, project.id],
      );
      if (pArchived.rows[0]?.archived) {
        throw new ConflictException({ statusCode: 409, message: "project_archived" });
      }

      await client.query("SELECT pg_advisory_xact_lock(hashtext('task_dependencies:' || $1::text))", [project.id]);

      const targetRes = await client.query<TaskRow>(
        "SELECT id, number, status FROM tasks WHERE org_id = $1 AND project_id = $2 AND number = $3",
        [org.orgId, project.id, number],
      );
      if (!targetRes.rows[0]) throw new NotFoundException({ statusCode: 404, message: "task_not_found" });
      const targetTask = targetRes.rows[0];

      const depRes = await client.query<TaskRow>(
        "SELECT id, number, status FROM tasks WHERE org_id = $1 AND project_id = $2 AND number = $3",
        [org.orgId, project.id, input.dependsOn],
      );
      if (!depRes.rows[0]) throw new NotFoundException({ statusCode: 404, message: "task_not_found" });
      const dependsOnTask = depRes.rows[0];

      const delRes = await client.query(
        `DELETE FROM task_dependencies
          WHERE org_id = $1 AND project_id = $2 AND task_id = $3 AND depends_on_task_id = $4
         RETURNING task_id`,
        [org.orgId, project.id, targetTask.id, dependsOnTask.id],
      );

      const changed = delRes.rowCount === 1;

      if (changed) {
        await writeAudit(client as unknown as Pool, {
          action: "task.dependency_removed",
          orgId: org.orgId,
          actorUserId: auth.userId,
          actorGithubUserId: auth.githubUserId,
          targetType: "task",
          targetId: targetTask.id,
          metadata: {
            number: targetTask.number,
            dependsOn: dependsOnTask.number,
          },
        });
      }

      await client.query("COMMIT");
      return { changed };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
