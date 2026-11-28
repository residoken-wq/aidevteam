import { z } from "zod";
import { SlugSchema } from "./common";
import { HealthResponseSchema } from "./health";
import {
  ProjectCreateSchema,
  ProjectListQuerySchema,
  ProjectMemberAssignSchema,
  ProjectMemberResultSchema,
  ProjectMemberSchema,
  ProjectMemberUnassignSchema,
  ProjectSchema,
  ProjectUpdateSchema,
} from "./project";
import {
  ProviderAccountCreateSchema,
  ProviderAccountLicenseChangeSchema,
  ProviderAccountListQuerySchema,
  ProviderAccountSchema,
  ProviderAccountUpdateSchema,
} from "./provider-account";
import {
  WorkerCreateSchema,
  WorkerListQuerySchema,
  WorkerSchema,
  WorkerUpdateSchema,
} from "./worker";
import {
  AgentCreateSchema,
  AgentListQuerySchema,
  AgentSchema,
  AgentUpdateSchema,
} from "./agent";
import {
  TaskCreateSchema,
  TaskDependenciesSchema,
  TaskDependencyChangeSchema,
  TaskDependencyResultSchema,
  TaskListQuerySchema,
  TaskSchema,
  TaskTransitionSchema,
  TaskUpdateSchema,
} from "./task";
import {
  DispatchRunSchema,
  RunListQuerySchema,
  RunSchema,
} from "./run";
import {
  OrgCreateSchema,
  OrgListQuerySchema,
  OrgSchema,
  OrgUpdateSchema,
} from "./org";
import { DashboardSchema } from "./dashboard";
import {
  ApprovalListQuerySchema,
  ApprovalListResponseSchema,
  ApprovalSchema,
} from "./approval";
import {
  MemberRoleChangeResultSchema,
  MemberRoleChangeSchema,
  MemberSchema,
} from "./member";
import { ErrorIssueSchema, ErrorResponseSchema } from "./error";

export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE" | "PUT";

export interface OpenApiOperationDef {
  method: HttpMethod;
  path: string;
  summary: string;
  permission?: string;
  request?: z.ZodType;
  query?: z.ZodType;
  responses: Record<number | string, z.ZodType | null>;
}

export interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: Record<string, unknown>;
}

export interface OpenApiOperationObject {
  summary: string;
  description?: string;
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    required?: boolean;
    content: {
      "application/json": {
        schema: Record<string, unknown>;
      };
    };
  };
  responses: Record<string, {
    description: string;
    content?: {
      "application/json": {
        schema: Record<string, unknown>;
      };
    };
  }>;
  "x-permission"?: string;
}

export interface OpenApiDocument {
  openapi: "3.1.0";
  info: {
    title: string;
    version: string;
    description: string;
  };
  paths: Record<string, Record<string, OpenApiOperationObject>>;
  components: {
    schemas: Record<string, Record<string, unknown>>;
  };
}

// Schemas for endpoints whose contracts were defined inline in controllers
export const MeResponseSchema = z.object({
  githubUserId: z.number().int(),
  githubLogin: z.string().nullable(),
  orgs: z.array(z.object({ slug: z.string(), roles: z.array(z.string()) })),
  activeOrg: z.object({
    slug: z.string(),
    roles: z.array(z.string()),
    permissions: z.array(z.string()),
  }).nullable(),
  platformPermissions: z.array(z.string()),
});

export const OrgCurrentResponseSchema = z.object({
  slug: z.string(),
  name: z.string(),
});

export const AuditEventSchema = z.object({
  id: z.number().int(),
  action: z.string(),
  actorGithubUserId: z.number().int().nullable(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  occurredAt: z.string(),
});

const makeListResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    limit: z.number().int(),
    offset: z.number().int(),
  });

export const ProjectListResponseSchema = makeListResponseSchema(ProjectSchema);
export const ProviderAccountListResponseSchema = makeListResponseSchema(ProviderAccountSchema);
export const WorkerListResponseSchema = makeListResponseSchema(WorkerSchema);
export const AgentListResponseSchema = makeListResponseSchema(AgentSchema);
export const TaskListResponseSchema = makeListResponseSchema(TaskSchema);
export const RunListResponseSchema = makeListResponseSchema(RunSchema);
export const OrgListResponseSchema = makeListResponseSchema(OrgSchema);

/**
 * Registry of all API operations implemented in the application controllers.
 * 14 controllers, exactly 51 endpoints.
 */
export const API_OPERATIONS: OpenApiOperationDef[] = [
  // HealthController (/health)
  {
    method: "GET",
    path: "/health/live",
    summary: "Liveness probe (process up)",
    permission: "public",
    responses: {
      200: HealthResponseSchema,
      500: ErrorResponseSchema,
    },
  },
  {
    method: "GET",
    path: "/health/ready",
    summary: "Readiness probe (database connectivity and schema verification)",
    permission: "public",
    responses: {
      200: HealthResponseSchema,
      500: ErrorResponseSchema,
      503: HealthResponseSchema,
    },
  },

  // AuthController (/auth)
  {
    method: "GET",
    path: "/auth/github/login",
    summary: "Initiate GitHub OAuth login flow",
    permission: "public",
    responses: {
      302: null,
      429: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  },
  {
    method: "GET",
    path: "/auth/github/callback",
    summary: "Handle GitHub OAuth authorization callback",
    permission: "public",
    query: z.object({
      code: z.string().optional(),
      state: z.string().optional(),
      error: z.string().optional(),
    }),
    responses: {
      303: null,
      400: ErrorResponseSchema,
      500: ErrorResponseSchema,
    },
  },
  {
    method: "GET",
    path: "/auth/me",
    summary: "Retrieve current authenticated user and session details",
    permission: "authenticated",
    responses: {
      200: MeResponseSchema,
      401: ErrorResponseSchema,
    },
  },
  {
    method: "POST",
    path: "/auth/active-org",
    summary: "Set active organization for the current user session",
    permission: "authenticated",
    request: z.object({ orgSlug: SlugSchema }),
    responses: {
      303: null,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "POST",
    path: "/auth/logout",
    summary: "Log out current session and clear session cookie",
    permission: "public",
    responses: {
      303: null,
      403: ErrorResponseSchema,
    },
  },

  // OrgController (/org)
  {
    method: "GET",
    path: "/org",
    summary: "Get active organization details for the session",
    permission: "org:read",
    responses: {
      200: OrgCurrentResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
    },
  },

  // MembersController (/org/members)
  {
    method: "GET",
    path: "/org/members",
    summary: "List all members and their roles in current organization",
    permission: "member:read",
    responses: {
      200: z.array(MemberSchema),
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
    },
  },
  {
    method: "POST",
    path: "/org/members/roles",
    summary: "Grant a role to a member in current organization",
    permission: "member:write",
    request: MemberRoleChangeSchema,
    responses: {
      200: MemberRoleChangeResultSchema,
      400: ErrorResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      409: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "DELETE",
    path: "/org/members/roles",
    summary: "Revoke a role from a member in current organization",
    permission: "member:write",
    request: MemberRoleChangeSchema,
    responses: {
      200: MemberRoleChangeResultSchema,
      400: ErrorResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      409: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },

  // AuditController (/audit)
  {
    method: "GET",
    path: "/audit/events",
    summary: "List audit log events in organization",
    permission: "audit:read",
    query: z.object({
      limit: z.coerce.number().int().min(1).max(200).default(50).optional(),
    }),
    responses: {
      200: z.array(AuditEventSchema),
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
    },
  },
  {
    method: "GET",
    path: "/audit/events/{id}",
    summary: "Get audit log event by ID",
    permission: "audit:read",
    responses: {
      200: AuditEventSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
    },
  },

  // ProjectsController (/projects)
  {
    method: "GET",
    path: "/projects",
    summary: "List projects in organization",
    permission: "project:read",
    query: ProjectListQuerySchema,
    responses: {
      200: ProjectListResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "GET",
    path: "/projects/{slug}",
    summary: "Get project by slug",
    permission: "project:read",
    responses: {
      200: ProjectSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
    },
  },
  {
    method: "POST",
    path: "/projects",
    summary: "Create a new project in organization",
    permission: "project:write",
    request: ProjectCreateSchema,
    responses: {
      201: ProjectSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      409: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "PATCH",
    path: "/projects/{slug}",
    summary: "Update existing project",
    permission: "project:write",
    request: ProjectUpdateSchema,
    responses: {
      200: ProjectSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "POST",
    path: "/projects/{slug}/archive",
    summary: "Archive project (soft delete)",
    permission: "project:write",
    responses: {
      200: ProjectSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
    },
  },
  {
    method: "GET",
    path: "/projects/{slug}/members",
    summary: "List members assigned to project",
    permission: "project:read",
    responses: {
      200: z.array(ProjectMemberSchema),
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
    },
  },
  {
    method: "POST",
    path: "/projects/{slug}/members",
    summary: "Assign a member to project",
    permission: "project:assign",
    request: ProjectMemberAssignSchema,
    responses: {
      200: ProjectMemberResultSchema,
      400: ErrorResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "DELETE",
    path: "/projects/{slug}/members",
    summary: "Unassign a member from project",
    permission: "project:assign",
    request: ProjectMemberUnassignSchema,
    responses: {
      200: ProjectMemberResultSchema,
      400: ErrorResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },

  // ProviderAccountsController (/provider-accounts)
  {
    method: "GET",
    path: "/provider-accounts",
    summary: "List provider accounts in organization",
    permission: "provider_account:read",
    query: ProviderAccountListQuerySchema,
    responses: {
      200: ProviderAccountListResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "GET",
    path: "/provider-accounts/{slug}",
    summary: "Get provider account by slug",
    permission: "provider_account:read",
    responses: {
      200: ProviderAccountSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
    },
  },
  {
    method: "POST",
    path: "/provider-accounts",
    summary: "Create provider account in organization",
    permission: "provider_account:write",
    request: ProviderAccountCreateSchema,
    responses: {
      201: ProviderAccountSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      409: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "PATCH",
    path: "/provider-accounts/{slug}",
    summary: "Update provider account",
    permission: "provider_account:write",
    request: ProviderAccountUpdateSchema,
    responses: {
      200: ProviderAccountSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "POST",
    path: "/provider-accounts/{slug}/archive",
    summary: "Archive provider account",
    permission: "provider_account:write",
    responses: {
      200: ProviderAccountSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
    },
  },
  {
    method: "POST",
    path: "/provider-accounts/{slug}/license",
    summary: "Change provider account license status (P2-09)",
    permission: "provider_account:license",
    request: ProviderAccountLicenseChangeSchema,
    responses: {
      200: ProviderAccountSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },

  // WorkersController (/workers)
  {
    method: "GET",
    path: "/workers",
    summary: "List workers in organization",
    permission: "worker:read",
    query: WorkerListQuerySchema,
    responses: {
      200: WorkerListResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "GET",
    path: "/workers/{slug}",
    summary: "Get worker by slug",
    permission: "worker:read",
    responses: {
      200: WorkerSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
    },
  },
  {
    method: "POST",
    path: "/workers",
    summary: "Create worker in organization",
    permission: "worker:write",
    request: WorkerCreateSchema,
    responses: {
      201: WorkerSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      409: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "PATCH",
    path: "/workers/{slug}",
    summary: "Update worker",
    permission: "worker:write",
    request: WorkerUpdateSchema,
    responses: {
      200: WorkerSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "POST",
    path: "/workers/{slug}/archive",
    summary: "Archive worker",
    permission: "worker:write",
    responses: {
      200: WorkerSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
    },
  },

  // AgentsController (/agents)
  {
    method: "GET",
    path: "/agents",
    summary: "List agents in organization",
    permission: "agent:read",
    query: AgentListQuerySchema,
    responses: {
      200: AgentListResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "GET",
    path: "/agents/{slug}",
    summary: "Get agent by slug",
    permission: "agent:read",
    responses: {
      200: AgentSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
    },
  },
  {
    method: "POST",
    path: "/agents",
    summary: "Create agent in organization",
    permission: "agent:write",
    request: AgentCreateSchema,
    responses: {
      201: AgentSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      409: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "PATCH",
    path: "/agents/{slug}",
    summary: "Update agent",
    permission: "agent:write",
    request: AgentUpdateSchema,
    responses: {
      200: AgentSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "POST",
    path: "/agents/{slug}/archive",
    summary: "Archive agent",
    permission: "agent:write",
    responses: {
      200: AgentSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
    },
  },

  // TasksController (/projects/:projectSlug/tasks)
  {
    method: "GET",
    path: "/projects/{projectSlug}/tasks",
    summary: "List tasks within project",
    permission: "task:read",
    query: TaskListQuerySchema,
    responses: {
      200: TaskListResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "GET",
    path: "/projects/{projectSlug}/tasks/{number}",
    summary: "Get task by project slug and task number",
    permission: "task:read",
    responses: {
      200: TaskSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
    },
  },
  {
    method: "POST",
    path: "/projects/{projectSlug}/tasks",
    summary: "Create a task in project",
    permission: "task:write",
    request: TaskCreateSchema,
    responses: {
      201: TaskSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "PATCH",
    path: "/projects/{projectSlug}/tasks/{number}",
    summary: "Update task details",
    permission: "task:write",
    request: TaskUpdateSchema,
    responses: {
      200: TaskSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "POST",
    path: "/projects/{projectSlug}/tasks/{number}/transitions",
    summary: "Transition task workflow status",
    permission: "task:write",
    request: TaskTransitionSchema,
    responses: {
      200: TaskSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },

  // TaskDependenciesController (/projects/:projectSlug/tasks/:number/dependencies)
  {
    method: "GET",
    path: "/projects/{projectSlug}/tasks/{number}/dependencies",
    summary: "Get task dependencies and blocked status",
    permission: "task:read",
    responses: {
      200: TaskDependenciesSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
    },
  },
  {
    method: "POST",
    path: "/projects/{projectSlug}/tasks/{number}/dependencies",
    summary: "Add a dependency to task",
    permission: "task:write",
    request: TaskDependencyChangeSchema,
    responses: {
      200: TaskDependencyResultSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "DELETE",
    path: "/projects/{projectSlug}/tasks/{number}/dependencies",
    summary: "Remove a dependency from task",
    permission: "task:write",
    request: TaskDependencyChangeSchema,
    responses: {
      200: TaskDependencyResultSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },

  // RunsController (/projects/:projectSlug/tasks/:number/dispatch, /runs/:id, etc.)
  {
    method: "POST",
    path: "/projects/{projectSlug}/tasks/{number}/dispatch",
    summary: "Dispatch a new agent run for task",
    permission: "dispatch:execute",
    request: DispatchRunSchema,
    responses: {
      201: RunSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
      422: ErrorResponseSchema,
      429: ErrorResponseSchema,
    },
  },
  {
    method: "GET",
    path: "/projects/{projectSlug}/tasks/{number}/runs",
    summary: "List runs for a specific task",
    permission: "run:read",
    query: RunListQuerySchema,
    responses: {
      200: RunListResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "GET",
    path: "/runs/{id}",
    summary: "Get agent run by UUID",
    permission: "run:read",
    responses: {
      200: RunSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
    },
  },
  {
    method: "POST",
    path: "/runs/{id}/cancel",
    summary: "Cancel an active or queued run",
    permission: "dispatch:execute",
    responses: {
      200: RunSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
    },
  },

  // PlatformOrgsController (/platform/orgs)
  {
    method: "GET",
    path: "/platform/orgs",
    summary: "List all organizations (platform admin only)",
    permission: "platform:org:read",
    query: OrgListQuerySchema,
    responses: {
      200: OrgListResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "GET",
    path: "/platform/orgs/{slug}",
    summary: "Get organization by slug (platform admin only)",
    permission: "platform:org:read",
    responses: {
      200: OrgSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
    },
  },
  {
    method: "POST",
    path: "/platform/orgs",
    summary: "Create a new organization (platform admin only)",
    permission: "platform:org:write",
    request: OrgCreateSchema,
    responses: {
      201: OrgSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      409: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "PATCH",
    path: "/platform/orgs/{slug}",
    summary: "Update organization name (platform admin only)",
    permission: "platform:org:write",
    request: OrgUpdateSchema,
    responses: {
      200: OrgSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "POST",
    path: "/platform/orgs/{slug}/archive",
    summary: "Archive organization (platform admin only)",
    permission: "platform:org:write",
    responses: {
      200: OrgSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
    },
  },
  {
    method: "POST",
    path: "/platform/orgs/{slug}/restore",
    summary: "Restore archived organization (platform admin only)",
    permission: "platform:org:write",
    responses: {
      200: OrgSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
      409: ErrorResponseSchema,
    },
  },

  // DashboardController (/dashboard)
  {
    method: "GET",
    path: "/dashboard",
    summary: "Get organization dashboard summary metrics",
    permission: "dashboard:read",
    responses: {
      200: DashboardSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
    },
  },

  // ApprovalsController (/approvals)
  {
    method: "GET",
    path: "/approvals",
    summary: "List release approval records for organization",
    permission: "approval:read",
    query: ApprovalListQuerySchema,
    responses: {
      200: ApprovalListResponseSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      422: ErrorResponseSchema,
    },
  },
  {
    method: "GET",
    path: "/approvals/{id}",
    summary: "Get release approval by UUID",
    permission: "approval:read",
    responses: {
      200: ApprovalSchema,
      401: ErrorResponseSchema,
      403: ErrorResponseSchema,
      404: ErrorResponseSchema,
    },
  },
];

/** Strip top-level $schema for subschema inlining in OpenAPI 3.1. */
export function cleanJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const full = { ...(z.toJSONSchema(schema) as Record<string, unknown>) };
  delete full.$schema;
  return full;
}

function defaultStatusDescription(status: number | string): string {
  const code = Number(status);
  switch (code) {
    case 200:
      return "Successful response";
    case 201:
      return "Resource created successfully";
    case 204:
      return "No content";
    case 302:
      return "Found (redirect)";
    case 303:
      return "See Other (redirect)";
    case 400:
      return "Bad request";
    case 401:
      return "Unauthorized (authentication required)";
    case 403:
      return "Forbidden (insufficient permissions or denied)";
    case 404:
      return "Resource not found";
    case 409:
      return "Conflict (state conflict or uniqueness violation)";
    case 422:
      return "Unprocessable entity (validation failure)";
    case 429:
      return "Too many requests (rate limit exceeded)";
    case 500:
      return "Internal server error";
    case 503:
      return "Service unavailable";
    default:
      return code >= 400 ? "Error response" : "Success";
  }
}

/**
 * Builds deterministic OpenAPI 3.1.0 document from the registry.
 */
export function buildOpenApiDocument(): OpenApiDocument {
  // Sort paths alphabetically
  const uniquePaths = Array.from(new Set(API_OPERATIONS.map((op) => op.path))).sort();

  const pathsObj: Record<string, Record<string, OpenApiOperationObject>> = {};

  const methodOrder: Record<HttpMethod, number> = {
    GET: 1,
    POST: 2,
    PUT: 3,
    PATCH: 4,
    DELETE: 5,
  };

  for (const path of uniquePaths) {
    const opsForPath = API_OPERATIONS.filter((op) => op.path === path).sort(
      (a, b) => (methodOrder[a.method] ?? 99) - (methodOrder[b.method] ?? 99),
    );

    const methodsMap: Record<string, OpenApiOperationObject> = {};

    for (const op of opsForPath) {
      const methodKey = op.method.toLowerCase();
      const parameters: OpenApiParameter[] = [];

      // Extract path parameters from route template e.g. {slug}, {number}
      const pathParamMatches = Array.from(op.path.matchAll(/\{([^}]+)\}/g));
      for (const match of pathParamMatches) {
        const paramName = match[1];
        if (paramName) {
          parameters.push({
            name: paramName,
            in: "path",
            required: true,
            schema: { type: "string" },
          });
        }
      }

      // Extract query parameters from query schema if present
      if (op.query) {
        const queryJson = cleanJsonSchema(op.query);
        const properties = (queryJson.properties as Record<string, Record<string, unknown>>) || {};
        const requiredList = (queryJson.required as string[]) || [];

        for (const qKey of Object.keys(properties).sort()) {
          parameters.push({
            name: qKey,
            in: "query",
            required: requiredList.includes(qKey),
            schema: properties[qKey],
          });
        }
      }

      const opResponses: Record<string, { description: string; content?: { "application/json": { schema: Record<string, unknown> } } }> = {};

      const sortedStatuses = Object.keys(op.responses).sort((a, b) => Number(a) - Number(b));

      for (const status of sortedStatuses) {
        const schema = op.responses[status];
        const statusCode = Number(status);

        if (statusCode >= 400 && (schema == null || schema === ErrorResponseSchema)) {
          opResponses[status] = {
            description: defaultStatusDescription(status),
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          };
        } else if (schema != null) {
          opResponses[status] = {
            description: defaultStatusDescription(status),
            content: {
              "application/json": {
                schema: cleanJsonSchema(schema),
              },
            },
          };
        } else {
          opResponses[status] = {
            description: defaultStatusDescription(status),
          };
        }
      }

      const operationObject: OpenApiOperationObject = {
        summary: op.summary,
        responses: opResponses,
      };

      if (op.permission) {
        operationObject["x-permission"] = op.permission;
      }

      if (parameters.length > 0) {
        operationObject.parameters = parameters;
      }

      if (op.request) {
        operationObject.requestBody = {
          required: true,
          content: {
            "application/json": {
              schema: cleanJsonSchema(op.request),
            },
          },
        };
      }

      methodsMap[methodKey] = operationObject;
    }

    pathsObj[path] = methodsMap;
  }

  const errorResponseJson = cleanJsonSchema(ErrorResponseSchema);
  const errorIssueJson = cleanJsonSchema(ErrorIssueSchema);

  return {
    openapi: "3.1.0",
    info: {
      title: "AI Dev Team Control Center API",
      version: "0.1.0",
      description:
        "API specification for AI Dev Team Control Center. OpenAPI 3.1.0 document in JSON format (valid YAML semantics without YAML parser dependency).",
    },
    paths: pathsObj,
    components: {
      schemas: {
        ErrorResponse: errorResponseJson,
        ErrorIssue: errorIssueJson,
      },
    },
  };
}
