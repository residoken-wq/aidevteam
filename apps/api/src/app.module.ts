import { Inject, Module, type DynamicModule, type OnApplicationShutdown, type Type } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { createPool, type Pool } from "@aidevteam/db";
import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { HttpGithubOAuthClient, type GithubOAuthClient } from "./auth/github-client";
import type { AppConfig } from "./config";
import { AuditController } from "./audit/audit.controller";
import { HealthController } from "./health/health.controller";
import { HealthService } from "./health/health.service";
import { OrgController } from "./org/org.controller";
import { MembersController } from "./org/members.controller";
import { ProjectsController } from "./projects/projects.controller";
import { ProviderAccountsController } from "./provider-accounts/provider-accounts.controller";
import { WorkersController } from "./workers/workers.controller";
import { AgentsController } from "./agents/agents.controller";
import { TasksController } from "./tasks/tasks.controller";
import { TaskDependenciesController } from "./tasks/task-dependencies.controller";
import { RunsController } from "./runs/runs.controller";
import { RunWorker } from "./runs/run-worker.service";
import { defaultMockRunner, type MockRunner } from "./runs/mock-runner";
import { PlatformOrgsController } from "./platform/platform-orgs.controller";
import { DashboardController } from "./dashboard/dashboard.controller";
import { ApprovalsController } from "./approvals/approvals.controller";
import { RateLimitService } from "./rate-limit";
import { RbacGuard } from "./rbac/rbac.guard";
import { RbacService } from "./rbac/rbac.service";
import { APP_CONFIG, DB_POOL, GITHUB_CLIENT, MOCK_RUNNER } from "./tokens";

export const APP_CONTROLLERS: Type[] = [
  HealthController,
  AuthController,
  OrgController,
  MembersController,
  AuditController,
  ProjectsController,
  ProviderAccountsController,
  WorkersController,
  AgentsController,
  TasksController,
  TaskDependenciesController,
  RunsController,
  PlatformOrgsController,
  DashboardController,
  ApprovalsController,
];

export interface AppOptions {
  config: AppConfig;
  /** Tests inject a fake GitHub client; production uses the HTTP client. */
  githubClient?: GithubOAuthClient;
  /** Tests may inject a pool; otherwise one is created from config.databaseUrl (lazy, connects on first query). */
  pool?: Pool;
  /** Test-only: extra controllers (e.g. a route without an access rule, to prove default deny). */
  extraControllers?: Type[];
  mockRunner?: MockRunner;
}

class PoolCloser implements OnApplicationShutdown {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end().catch(() => undefined);
  }
}

@Module({})
export class AppModule {
  static forRoot(options: AppOptions): DynamicModule {
    const ownsPool = !options.pool;
    return {
      module: AppModule,
      controllers: [...APP_CONTROLLERS, ...(options.extraControllers ?? [])],
      providers: [
        { provide: APP_CONFIG, useValue: options.config },
        { provide: DB_POOL, useValue: options.pool ?? createPool(options.config.databaseUrl) },
        {
          provide: GITHUB_CLIENT,
          useValue: options.githubClient ?? new HttpGithubOAuthClient(options.config.github.clientId, options.config.github.clientSecret),
        },
        {
          provide: MOCK_RUNNER,
          useValue: options.mockRunner ?? defaultMockRunner,
        },
        AuthService,
        HealthService,
        RbacService,
        RateLimitService,
        RunWorker,
        // Global default-deny guard: every route must declare @Public, @Authenticated or @RequirePermission.
        { provide: APP_GUARD, useClass: RbacGuard },
        ...(ownsPool ? [PoolCloser] : []),
      ],
    };
  }
}
