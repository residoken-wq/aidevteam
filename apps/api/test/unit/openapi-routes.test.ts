import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod, type Type } from "@nestjs/common";
import {
  buildOpenApiDocument,
  ErrorResponseSchema,
  ProjectCreateSchema,
} from "@aidevteam/contracts";
import { APP_CONTROLLERS } from "../../src/app.module";
import { parseOr422, rethrowConflict } from "../../src/validation";

function normalizeRoutePath(controllerPrefix: string | undefined, methodPath: string | undefined): string {
  const p1 = (controllerPrefix || "").trim().replace(/^\/+|\/+$/g, "");
  const p2 = (methodPath || "").trim().replace(/^\/+|\/+$/g, "");
  const combined = [p1, p2].filter(Boolean).join("/");
  // Convert Express style :param to OpenAPI style {param}
  return "/" + combined.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

describe("Route ↔ OpenAPI spec parity (AC-2)", () => {
  it("Nest controller routes exactly match OpenAPI spec operations", () => {
    // 1. Controller classes: the same list AppModule.forRoot() registers
    const controllers: Type[] | undefined = APP_CONTROLLERS;
    expect(controllers, "APP_CONTROLLERS must be defined").toBeDefined();
    expect(Array.isArray(controllers)).toBe(true);
    expect(controllers!.length).toBeGreaterThan(0);

    // 2. Discover all routes across controllers
    const nestRoutes = new Set<string>();

    for (const Ctrl of controllers!) {
      const prefix = Reflect.getMetadata(PATH_METADATA, Ctrl) as string | undefined;
      const prototype = Ctrl.prototype;
      const propertyNames = Object.getOwnPropertyNames(prototype);

      for (const name of propertyNames) {
        if (name === "constructor") continue;
        const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
        if (!descriptor || typeof descriptor.value !== "function") continue;

        const methodMeta = Reflect.getMetadata(METHOD_METADATA, descriptor.value) as number | undefined;
        if (methodMeta === undefined) continue;

        const pathMeta = Reflect.getMetadata(PATH_METADATA, descriptor.value) as string | undefined;
        const httpMethod = RequestMethod[methodMeta];
        const normalizedPath = normalizeRoutePath(prefix, pathMeta);
        const routeKey = `${httpMethod} ${normalizedPath}`;
        nestRoutes.add(routeKey);
      }
    }

    // 3. Extract all operations from the generated OpenAPI document
    const doc = buildOpenApiDocument();
    const specRoutes = new Set<string>();

    for (const [pathKey, methodsObj] of Object.entries(doc.paths)) {
      for (const methodKey of Object.keys(methodsObj)) {
        const routeKey = `${methodKey.toUpperCase()} ${pathKey}`;
        specRoutes.add(routeKey);
      }
    }

    // 4. Assert parity: missing or extra routes must fail
    const missingInSpec = [...nestRoutes].filter((r) => !specRoutes.has(r)).sort();
    const extraInSpec = [...specRoutes].filter((r) => !nestRoutes.has(r)).sort();

    if (missingInSpec.length > 0 || extraInSpec.length > 0) {
      const details = [
        missingInSpec.length ? `Routes in Nest but MISSING in OpenAPI spec:\n  ${missingInSpec.join("\n  ")}` : "",
        extraInSpec.length ? `Routes in OpenAPI spec but MISSING in Nest controllers:\n  ${extraInSpec.join("\n  ")}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      expect.fail(`Route ↔ OpenAPI spec mismatch:\n${details}`);
    }

    expect(nestRoutes.size).toBe(specRoutes.size);
    expect(nestRoutes.size).toBeGreaterThan(0);
  });
});

describe("Error response format (AC-3)", () => {
  it("ErrorResponseSchema successfully parses real 422 exception from parseOr422", () => {
    let thrownError: unknown;
    try {
      parseOr422(ProjectCreateSchema, { slug: "INVALID-SLUG", extraUnknown: "test" });
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeDefined();
    const responseBody = (thrownError as { getResponse: () => unknown }).getResponse();
    expect(responseBody).toBeDefined();

    const parsed = ErrorResponseSchema.parse(responseBody);
    expect(parsed.statusCode).toBe(422);
    expect(parsed.message).toBe("validation_failed");
    expect(parsed.issues).toBeDefined();
    expect(parsed.issues!.length).toBeGreaterThan(0);
    expect(parsed.issues![0]).toHaveProperty("path");
    expect(parsed.issues![0]).toHaveProperty("message");
  });

  it("ErrorResponseSchema successfully parses real 409 exception from rethrowConflict", () => {
    let thrownError: unknown;
    try {
      rethrowConflict({ code: "23505" }, "slug_taken");
    } catch (err) {
      thrownError = err;
    }

    expect(thrownError).toBeDefined();
    const responseBody = (thrownError as { getResponse: () => unknown }).getResponse();
    expect(responseBody).toBeDefined();

    const parsed = ErrorResponseSchema.parse(responseBody);
    expect(parsed.statusCode).toBe(409);
    expect(parsed.message).toBe("slug_taken");
  });

  it("tolerates extra fields on error payload (non-strict mode chosen)", () => {
    const payloadWithExtra = {
      statusCode: 422,
      message: "validation_failed",
      issues: [{ path: "slug", message: "invalid" }],
      extraFieldFromProxy: "proxy-info",
      timestamp: 123456789,
    };

    const parsed = ErrorResponseSchema.parse(payloadWithExtra);
    expect(parsed.statusCode).toBe(422);
    expect(parsed.message).toBe("validation_failed");
  });
});
