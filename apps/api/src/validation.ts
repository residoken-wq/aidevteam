import { ConflictException, UnprocessableEntityException } from "@nestjs/common";
import type { z } from "zod";

/**
 * Validate untrusted input with a contract schema. 422 lists field paths + messages only —
 * never the submitted values (P1-07: input may contain secrets or PII).
 */
export function parseOr422<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  throw new UnprocessableEntityException({
    statusCode: 422,
    message: "validation_failed",
    issues: r.error.issues.map((i) => ({ path: i.path.map(String).join("."), message: i.message })),
  });
}

/** Map PostgreSQL unique violations to 409 without leaking constraint or value details. */
export function rethrowConflict(err: unknown, message = "conflict"): never {
  if (typeof err === "object" && err !== null && (err as { code?: string }).code === "23505") {
    throw new ConflictException({ statusCode: 409, message });
  }
  throw err;
}
