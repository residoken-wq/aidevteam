import { Controller, Get, HttpCode } from "@nestjs/common";
import type { HealthResponse } from "@aidevteam/contracts";
import { Public } from "../rbac/decorators";

/**
 * Health probes (P1-10 adds the database readiness check).
 * Responses follow HealthResponseSchema and never include versions, hosts or error details.
 */
@Public()
@Controller("health")
export class HealthController {
  @Get("live")
  @HttpCode(200)
  live(): HealthResponse {
    return { status: "ok", checks: {} };
  }

  @Get("ready")
  @HttpCode(200)
  ready(): HealthResponse {
    // No dependencies yet in P1-01. P1-10 must add the database check and return 503 when it fails.
    return { status: "ok", checks: {} };
  }
}
