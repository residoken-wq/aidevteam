import { Inject, Injectable } from "@nestjs/common";
import type { Pool } from "@aidevteam/db";
import { sha256 } from "./crypto";
import { DB_POOL } from "./tokens";

export interface RateLimitRule {
  scope: string;
  limit: number;
  windowSeconds: number;
}

/** 5 login starts per 15 minutes per client IP (decided 26/11/2026, DECISION_LOG D-2026-11-26-02). */
export const LOGIN_RATE_LIMIT: RateLimitRule = { scope: "auth.login", limit: 5, windowSeconds: 15 * 60 };

/**
 * Fixed-window counter stored in PostgreSQL so it holds across api replicas and restarts.
 * The client key (IP) is stored only as SHA-256. A fixed window can admit up to 2×limit around a
 * window boundary — accepted trade-off for 0.1.
 */
@Injectable()
export class RateLimitService {
  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  async hit(rule: RateLimitRule, clientKey: string, now: Date = new Date()): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const windowMs = rule.windowSeconds * 1000;
    const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
    const r = await this.pool.query<{ hits: number }>(
      `INSERT INTO rate_limit_hits (scope, bucket, window_start, hits) VALUES ($1, $2, $3, 1)
       ON CONFLICT (scope, bucket, window_start) DO UPDATE SET hits = rate_limit_hits.hits + 1
       RETURNING hits`,
      [rule.scope, sha256(`${rule.scope}|${clientKey}`), windowStart],
    );
    // Housekeeping: drop counters older than one day (small table, indexed by window_start).
    await this.pool.query("DELETE FROM rate_limit_hits WHERE window_start < $1", [new Date(now.getTime() - 24 * 3600 * 1000)]);
    const retryAfterSeconds = Math.ceil((windowStart.getTime() + windowMs - now.getTime()) / 1000);
    return { allowed: r.rows[0]!.hits <= rule.limit, retryAfterSeconds };
  }
}
