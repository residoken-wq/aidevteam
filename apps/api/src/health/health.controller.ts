import { Controller, Get, HttpCode, Res } from "@nestjs/common";
import type { HealthResponse } from "@aidevteam/contracts";
import type { Response } from "express";
import { Public } from "../rbac/decorators";
import { HealthService } from "./health.service";

/**
 * Health probes (P1-10). Public, no session.
 * - live: the process is up; never touches the database (a DB outage must not restart healthy containers).
 * - ready: database reachable and schema at the expected migration; 503 otherwise.
 * Responses follow HealthResponseSchema and never include versions, hosts or error details.
 */
@Public()
@Controller("health")
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get("live")
  @HttpCode(200)
  live(@Res({ passthrough: true }) res: Response): HealthResponse {
    res.setHeader("Cache-Control", "no-store");
    return { status: "ok", checks: {} };
  }

  @Get("ready")
  async ready(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    res.setHeader("Cache-Control", "no-store");
    const result = await this.health.readiness();
    res.status(result.status === "ok" ? 200 : 503);
    return result;
  }
}
