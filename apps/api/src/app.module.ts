import { Inject, Module, type DynamicModule, type OnApplicationShutdown } from "@nestjs/common";
import { createPool, type Pool } from "@aidevteam/db";
import { AuthController } from "./auth/auth.controller";
import { AuthService } from "./auth/auth.service";
import { HttpGithubOAuthClient, type GithubOAuthClient } from "./auth/github-client";
import type { AppConfig } from "./config";
import { HealthController } from "./health/health.controller";
import { APP_CONFIG, DB_POOL, GITHUB_CLIENT } from "./tokens";

export interface AppOptions {
  config: AppConfig;
  /** Tests inject a fake GitHub client; production uses the HTTP client. */
  githubClient?: GithubOAuthClient;
  /** Tests may inject a pool; otherwise one is created from config.databaseUrl (lazy, connects on first query). */
  pool?: Pool;
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
      controllers: [HealthController, AuthController],
      providers: [
        { provide: APP_CONFIG, useValue: options.config },
        { provide: DB_POOL, useValue: options.pool ?? createPool(options.config.databaseUrl) },
        {
          provide: GITHUB_CLIENT,
          useValue: options.githubClient ?? new HttpGithubOAuthClient(options.config.github.clientId, options.config.github.clientSecret),
        },
        AuthService,
        ...(ownsPool ? [PoolCloser] : []),
      ],
    };
  }
}
