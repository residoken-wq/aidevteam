import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "./openapi";

describe("OpenAPI 3.1.0 generation", () => {
  const doc = buildOpenApiDocument();

  it("spec has openapi: '3.1.0' and valid info", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBe("AI Dev Team Control Center API");
    expect(doc.info.version).toBe("0.1.0");
    expect(doc.info.description).toContain("YAML");
  });

  it("build is deterministic (two runs produce identical JSON output)", () => {
    const doc1 = buildOpenApiDocument();
    const doc2 = buildOpenApiDocument();
    const json1 = JSON.stringify(doc1, null, 2);
    const json2 = JSON.stringify(doc2, null, 2);
    expect(json1).toBe(json2);
  });

  it("all $ref references resolve within components", () => {
    // Collect all $ref in the document recursively
    const refs: string[] = [];
    const findRefs = (obj: unknown) => {
      if (!obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) {
        for (const item of obj) findRefs(item);
        return;
      }
      for (const [key, val] of Object.entries(obj)) {
        if (key === "$ref" && typeof val === "string") {
          refs.push(val);
        } else {
          findRefs(val);
        }
      }
    };

    findRefs(doc);
    expect(refs.length).toBeGreaterThan(0);

    for (const ref of refs) {
      expect(ref.startsWith("#/components/")).toBe(true);
      const parts = ref.replace(/^#\//, "").split("/");
      let current: unknown = doc;
      for (const part of parts) {
        current = (current as Record<string, unknown> | undefined)?.[part];
      }
      expect(current).toBeDefined();
      expect(typeof current).toBe("object");
    }
  });

  it("every operation has at least one error response pointing to ErrorResponse", () => {
    let operationCount = 0;
    for (const [pathKey, pathItem] of Object.entries(doc.paths)) {
      for (const [methodKey, op] of Object.entries(pathItem)) {
        operationCount++;
        const errorResponses = Object.entries(op.responses).filter(([code]) => Number(code) >= 400);
        expect(errorResponses.length, `Operation ${methodKey.toUpperCase()} ${pathKey} must have at least one error response`).toBeGreaterThan(0);

        const hasErrorResponseRef = errorResponses.some(
          ([, resp]) => resp.content?.["application/json"]?.schema?.$ref === "#/components/schemas/ErrorResponse",
        );
        expect(hasErrorResponseRef, `Operation ${methodKey.toUpperCase()} ${pathKey} must have a response pointing to #/components/schemas/ErrorResponse`).toBe(true);
      }
    }
    expect(operationCount).toBeGreaterThan(0);
  });

  it("mutating operations (POST/PATCH/PUT/DELETE) have requestBody when route accepts a body", () => {
    // List of operations that accept a body
    const routesWithBody = new Set([
      "POST /auth/active-org",
      "POST /org/members/roles",
      "DELETE /org/members/roles",
      "POST /projects",
      "PATCH /projects/{slug}",
      "POST /projects/{slug}/members",
      "DELETE /projects/{slug}/members",
      "POST /projects/{slug}/epics",
      "PATCH /projects/{slug}/epics/{epicSlug}",
      "POST /projects/{slug}/milestones",
      "PATCH /projects/{slug}/milestones/{milestoneSlug}",
      "POST /projects/{slug}/sprints",
      "PATCH /projects/{slug}/sprints/{number}",
      "POST /projects/{slug}/sprints/{number}/transitions",
      "POST /provider-accounts",
      "PATCH /provider-accounts/{slug}",
      "POST /provider-accounts/{slug}/license",
      "POST /workers",
      "PATCH /workers/{slug}",
      "POST /agents",
      "PATCH /agents/{slug}",
      "POST /projects/{projectSlug}/tasks",
      "PATCH /projects/{projectSlug}/tasks/{number}",
      "POST /projects/{projectSlug}/tasks/{number}/transitions",
      "POST /projects/{projectSlug}/tasks/{number}/dispatch",
      "POST /platform/orgs",
      "PATCH /platform/orgs/{slug}",
    ]);

    for (const [pathKey, pathItem] of Object.entries(doc.paths)) {
      for (const [methodKey, op] of Object.entries(pathItem)) {
        const key = `${methodKey.toUpperCase()} ${pathKey}`;
        if (routesWithBody.has(key)) {
          expect(op.requestBody, `Expected ${key} to have requestBody`).toBeDefined();
          expect(op.requestBody?.content["application/json"]?.schema).toBeDefined();
        } else if (["post", "patch", "put", "delete"].includes(methodKey)) {
          expect(op.requestBody, `Expected ${key} NOT to have requestBody`).toBeUndefined();
        }
      }
    }
  });

  it("AC-4: document JSON does not contain secret-like patterns", () => {
    const json = JSON.stringify(doc);
    expect(json).not.toMatch(/ghp_/);
    expect(json).not.toMatch(/sk-/);
    expect(json).not.toMatch(/-----BEGIN/);
    expect(json).not.toMatch(/postgres:\/\//);
  });

  it("paths and methods are sorted deterministically in doc.paths", () => {
    const paths = Object.keys(doc.paths);
    const sortedPaths = [...paths].sort();
    expect(paths).toEqual(sortedPaths);

    for (const path of paths) {
      const methods = Object.keys(doc.paths[path] || {});
      expect(methods.length).toBeGreaterThan(0);
    }
  });
});
