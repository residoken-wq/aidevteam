import { z } from "zod";

/**
 * Response of GET /health/live and GET /health/ready.
 * Must never expose host names, versions, connection strings or raw error messages.
 */
export const HealthStatusSchema = z.enum(["ok", "unavailable"]);

export const HealthResponseSchema = z
  .object({
    status: HealthStatusSchema,
    checks: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), HealthStatusSchema),
  })
  .strict();

export type HealthStatus = z.infer<typeof HealthStatusSchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
