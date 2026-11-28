import {
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Put,
  Req,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  buildAgentPrompt,
  getEffectiveForbiddenPaths,
  isDenylistedPath,
  SlugSchema,
  TaskContractSchema,
  type TaskContract,
  type TaskContractResponse,
  type TaskPromptResponse,
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
  title: string;
  description: string | null;
  status: string;
  contract: TaskContract | null;
}

@Controller("projects/:projectSlug/tasks/:number/contract")
export class TaskContractController {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  @RequirePermission("task:read")
  @Get()
  async getContract(
    @Req() req: Request,
    @Param("projectSlug") projectSlug: string,
    @Param("number") number: string,
  ): Promise<TaskContractResponse> {
    if (!NUMBER_RE.test(number) || !SlugSchema.safeParse(projectSlug).success) throw new NotFoundException();
    const taskNumber = Number(number);

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

    const task = await this.findTask(org.orgId, project.id, taskNumber);
    return {
      contract: task.contract,
      effectiveForbiddenPaths: getEffectiveForbiddenPaths(task.contract),
    };
  }

  @RequirePermission("task:write")
  @Put()
  async putContract(
    @Req() req: Request,
    @Param("projectSlug") projectSlug: string,
    @Param("number") number: string,
    @Body() body: unknown,
  ): Promise<TaskContractResponse> {
    if (!NUMBER_RE.test(number) || !SlugSchema.safeParse(projectSlug).success) throw new NotFoundException();
    const taskNumber = Number(number);

    const org = getOrg(req);
    const auth = getAuth(req);
    const project = await verifyProjectScope({
      pool: this.pool,
      orgId: org.orgId,
      userId: auth.userId,
      roles: org.roles,
      requiredAccess: "write",
      projectSlug,
    });

    const task = await this.findTask(org.orgId, project.id, taskNumber);
    if (task.status === "DONE" || task.status === "CANCELLED") {
      throw new ConflictException({ statusCode: 409, message: "task_closed" });
    }

    let contract: TaskContract;
    try {
      contract = parseOr422(TaskContractSchema, body);
    } catch (err) {
      if (err instanceof UnprocessableEntityException) {
        const resp = err.getResponse() as {
          statusCode?: number;
          message?: string;
          issues?: Array<{ message?: string; problem?: string; path?: string }>;
        };
        if (resp.issues?.some((i) => i.message === "path_forbidden" || i.problem === "path_forbidden")) {
          throw new UnprocessableEntityException({
            statusCode: 422,
            message: "path_forbidden",
            issues: resp.issues,
          });
        }
      }
      throw err;
    }

    if (contract.allowedPaths.some(isDenylistedPath)) {
      throw new UnprocessableEntityException({
        statusCode: 422,
        message: "path_forbidden",
        issues: [{ path: "allowedPaths", message: "path_forbidden" }],
      });
    }

    await this.pool.query(
      "UPDATE tasks SET contract = $1, updated_at = now() WHERE org_id = $2 AND project_id = $3 AND number = $4",
      [JSON.stringify(contract), org.orgId, project.id, taskNumber],
    );

    await writeAudit(this.pool, {
      action: "task.contract_updated",
      orgId: org.orgId,
      actorUserId: auth.userId,
      actorGithubUserId: auth.githubUserId,
      targetType: "task",
      targetId: task.id,
      requestId: (req.headers["x-request-id"] as string) ?? null,
      metadata: {
        acceptanceCriteriaCount: contract.acceptanceCriteria.length,
        allowedPathsCount: contract.allowedPaths.length,
        forbiddenPathsCount: contract.forbiddenPaths.length,
        testCommandsCount: contract.testCommands.length,
        outOfScopeCount: contract.outOfScope.length,
      },
    });

    return {
      contract,
      effectiveForbiddenPaths: getEffectiveForbiddenPaths(contract),
    };
  }

  @RequirePermission("task:read")
  @Get("prompt")
  async getPrompt(
    @Req() req: Request,
    @Param("projectSlug") projectSlug: string,
    @Param("number") number: string,
  ): Promise<TaskPromptResponse> {
    if (!NUMBER_RE.test(number) || !SlugSchema.safeParse(projectSlug).success) throw new NotFoundException();
    const taskNumber = Number(number);

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

    const task = await this.findTask(org.orgId, project.id, taskNumber);
    const prompt = buildAgentPrompt(task, task.contract);
    return { prompt };
  }

  private async findTask(orgId: string, projectId: string, number: number): Promise<TaskRow> {
    const res = await this.pool.query<TaskRow>(
      `SELECT id, number, title, description, status, contract
         FROM tasks
        WHERE org_id = $1 AND project_id = $2 AND number = $3`,
      [orgId, projectId, number],
    );
    const task = res.rows[0];
    if (!task) throw new NotFoundException();
    return task;
  }
}
