import { z } from "zod";

/**
 * Standard error issue item (for 422 validation errors).
 */
export const ErrorIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
  problem: z.string().optional(),
});
export type ErrorIssue = z.infer<typeof ErrorIssueSchema>;

/**
 * Standard API error response format across the application.
 * Non-strict so it remains resilient if Nest or gateway injects additional fields.
 */
export const ErrorResponseSchema = z.object({
  statusCode: z.number().int(),
  message: z.string(),
  issues: z.array(ErrorIssueSchema).optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
