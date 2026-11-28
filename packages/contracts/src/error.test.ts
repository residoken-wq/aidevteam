import { describe, expect, it } from "vitest";
import { ErrorIssueSchema, ErrorResponseSchema } from "./error";

describe("ErrorResponseSchema", () => {
  it("parses minimal error response (status + message)", () => {
    const data = {
      statusCode: 409,
      message: "project_slug_or_name_taken",
    };
    const parsed = ErrorResponseSchema.parse(data);
    expect(parsed).toEqual(data);
  });

  it("parses validation failure with issues array", () => {
    const data = {
      statusCode: 422,
      message: "validation_failed",
      issues: [
        { path: "name", message: "name is required" },
        { path: "secretRef", message: "secret_like", problem: "secret_like" },
      ],
    };
    const parsed = ErrorResponseSchema.parse(data);
    expect(parsed.statusCode).toBe(422);
    expect(parsed.message).toBe("validation_failed");
    expect(parsed.issues).toHaveLength(2);
    expect(parsed.issues![0]).toEqual({ path: "name", message: "name is required" });
    expect(parsed.issues![1]).toEqual({ path: "secretRef", message: "secret_like", problem: "secret_like" });
  });

  it("tolerates unknown/extra fields (non-strict) to avoid breaking with framework headers/fields", () => {
    const data = {
      statusCode: 400,
      message: "bad_request",
      error: "Bad Request",
      timestamp: new Date().toISOString(),
      extraField: "ignored",
    };
    const parsed = ErrorResponseSchema.parse(data);
    expect(parsed.statusCode).toBe(400);
    expect(parsed.message).toBe("bad_request");
  });

  it("rejects invalid payloads missing statusCode or message", () => {
    expect(() => ErrorResponseSchema.parse({ message: "missing status" })).toThrow();
    expect(() => ErrorResponseSchema.parse({ statusCode: 400 })).toThrow();
    expect(() => ErrorResponseSchema.parse({ statusCode: "400", message: "string status" })).toThrow();
  });
});

describe("ErrorIssueSchema", () => {
  it("parses valid issue object", () => {
    const issue = { path: "slug", message: "invalid format", problem: "regex" };
    expect(ErrorIssueSchema.parse(issue)).toEqual(issue);
  });
});
