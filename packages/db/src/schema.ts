import { sql } from "drizzle-orm";
import { bigint, boolean, check, customType, date, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * Typed Drizzle view of the schema created by migrations/*.up.sql.
 * The SQL migrations are the source of truth for DDL (constraints, triggers);
 * test/integration/drift.test.ts fails if columns here and in the database diverge.
 */

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const orgs = pgTable("orgs", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  archivedAt: ts("archived_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  // GitHub user ids are well below 2^53, so number mode is safe.
  githubUserId: bigint("github_user_id", { mode: "number" }).notNull().unique(),
  githubLogin: text("github_login"),
  createdAt: ts("created_at").notNull().defaultNow(),
  disabledAt: ts("disabled_at"),
});

export const userAllowlist = pgTable("user_allowlist", {
  githubUserId: bigint("github_user_id", { mode: "number" }).primaryKey(),
  note: text("note"),
  addedByUserId: uuid("added_by_user_id").references(() => users.id),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: uuid("org_id").notNull().references(() => orgs.id),
    key: text("key").notNull(),
    name: text("name").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [unique("roles_org_key_unique").on(t.orgId, t.key), unique("roles_id_org_unique").on(t.id, t.orgId)],
);

export const roleBindings = pgTable(
  "role_bindings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: uuid("org_id").notNull().references(() => orgs.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    roleId: uuid("role_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({ name: "role_bindings_role_same_org_fk", columns: [t.roleId, t.orgId], foreignColumns: [roles.id, roles.orgId] }),
    unique("role_bindings_unique").on(t.userId, t.roleId),
    index("role_bindings_org_user_idx").on(t.orgId, t.userId),
  ],
);

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  /** SHA-256 of the session token. The token itself is never stored. */
  tokenHash: bytea("token_hash").notNull().unique(),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  /** Org the user is currently working in (P1-06). Tenant scope comes only from here. */
  activeOrgId: uuid("active_org_id").references(() => orgs.id),
});

export const auditEvents = pgTable("audit_events", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  orgId: uuid("org_id").references(() => orgs.id),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  actorGithubUserId: bigint("actor_github_user_id", { mode: "number" }),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  requestId: text("request_id"),
  /** Must already be redacted (no tokens, emails, phone numbers, national ids). */
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  occurredAt: ts("occurred_at").notNull().defaultNow(),
});

export const releaseApprovals = pgTable("release_approvals", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: uuid("org_id")
    .notNull()
    .references(() => orgs.id),
  environment: text("environment", { enum: ["uat", "production"] }).notNull(),
  decision: text("decision", { enum: ["approved", "rejected"] }).notNull(),
  targetSha: text("target_sha").notNull(),
  releaseManifestDigest: text("release_manifest_digest").notNull(),
  pipelineRunId: text("pipeline_run_id").notNull(),
  approverGithubUserId: bigint("approver_github_user_id", { mode: "number" }).notNull(),
  sourceCommentUrl: text("source_comment_url").notNull(),
  decidedAt: ts("decided_at").notNull(),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
});

export const oauthLoginStates = pgTable("oauth_login_states", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  /** SHA-256 of the OAuth `state` value. */
  stateHash: bytea("state_hash").notNull().unique(),
  codeVerifier: text("code_verifier").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});

export const rateLimitHits = pgTable(
  "rate_limit_hits",
  {
    scope: text("scope").notNull(),
    /** SHA-256 of the client key (e.g. IP). */
    bucket: bytea("bucket").notNull(),
    windowStart: ts("window_start").notNull(),
    hits: integer("hits").notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.bucket, t.windowStart] }), index("rate_limit_hits_window_idx").on(t.windowStart)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    archivedAt: ts("archived_at"),
  },
  (t) => [unique("projects_org_slug_unique").on(t.orgId, t.slug), unique("projects_id_org_unique").on(t.id, t.orgId)],
);

export const providerAccounts = pgTable(
  "provider_accounts",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    provider: text("provider", { enum: ["anthropic", "openai", "google", "github", "other"] }).notNull(),
    /** Pointer only (env:AIDEV_SECRET_… or file:/run/secrets/…), never the credential. */
    secretRef: text("secret_ref").notNull(),
    description: text("description"),
    licenseStatus: text("license_status", { enum: ["approved", "unverified", "prohibited"] })
      .notNull()
      .default("unverified"),
    licenseStatusChangedAt: ts("license_status_changed_at"),
    licenseStatusChangedByUserId: uuid("license_status_changed_by_user_id").references(() => users.id),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    archivedAt: ts("archived_at"),
  },
  (t) => [unique("provider_accounts_org_slug_unique").on(t.orgId, t.slug), unique("provider_accounts_id_org_unique").on(t.id, t.orgId)],
);

export const workers = pgTable(
  "workers",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    type: text("type", { enum: ["mock"] }).notNull(),
    workspacePath: text("workspace_path").notNull(),
    projectId: uuid("project_id"),
    enabled: boolean("enabled").notNull().default(true),
    description: text("description"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    archivedAt: ts("archived_at"),
  },
  (t) => [
    unique("workers_org_slug_unique").on(t.orgId, t.slug),
    unique("workers_id_org_unique").on(t.id, t.orgId),
    foreignKey({ name: "workers_project_same_org_fk", columns: [t.projectId, t.orgId], foreignColumns: [projects.id, projects.orgId] }),
  ],
);

/** Operator-granted (CLI) platform administrators: manage orgs, but get no access to data inside an org. */
export const platformAdmins = pgTable("platform_admins", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id),
  note: text("note"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    title: text("title"),
    model: text("model"),
    providerAccountId: uuid("provider_account_id"),
    reportsToAgentId: uuid("reports_to_agent_id"),
    enabled: boolean("enabled").notNull().default(true),
    description: text("description"),
    capabilities: text("capabilities")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    maxActiveTasks: integer("max_active_tasks").notNull().default(3),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    archivedAt: ts("archived_at"),
  },
  (t) => [
    unique("agents_org_slug_unique").on(t.orgId, t.slug),
    unique("agents_id_org_unique").on(t.id, t.orgId),
    foreignKey({ name: "agents_provider_same_org_fk", columns: [t.providerAccountId, t.orgId], foreignColumns: [providerAccounts.id, providerAccounts.orgId] }),
    foreignKey({ name: "agents_manager_same_org_fk", columns: [t.reportsToAgentId, t.orgId], foreignColumns: [t.id, t.orgId] }),
    check("agents_capabilities_len_check", sql`cardinality(${t.capabilities}) <= 20`),
    check("agents_max_active_tasks_range", sql`${t.maxActiveTasks} >= 1 AND ${t.maxActiveTasks} <= 50`),
  ],
);

export const milestones = pgTable(
  "milestones",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    projectId: uuid("project_id").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    dueDate: date("due_date"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    archivedAt: ts("archived_at"),
  },
  (t) => [
    unique("milestones_project_slug_unique").on(t.projectId, t.slug),
    unique("milestones_id_org_unique").on(t.id, t.orgId),
    unique("milestones_id_project_unique").on(t.id, t.projectId),
    foreignKey({ name: "milestones_project_same_org_fk", columns: [t.projectId, t.orgId], foreignColumns: [projects.id, projects.orgId] }),
    index("milestones_org_project_idx").on(t.orgId, t.projectId),
  ],
);

export const epics = pgTable(
  "epics",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    projectId: uuid("project_id").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    milestoneId: uuid("milestone_id"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    archivedAt: ts("archived_at"),
  },
  (t) => [
    unique("epics_project_slug_unique").on(t.projectId, t.slug),
    unique("epics_id_org_unique").on(t.id, t.orgId),
    unique("epics_id_project_unique").on(t.id, t.projectId),
    foreignKey({ name: "epics_project_same_org_fk", columns: [t.projectId, t.orgId], foreignColumns: [projects.id, projects.orgId] }),
    foreignKey({ name: "epics_milestone_same_project_fk", columns: [t.milestoneId, t.projectId], foreignColumns: [milestones.id, milestones.projectId] }),
    index("epics_org_project_idx").on(t.orgId, t.projectId),
  ],
);

export const sprints = pgTable(
  "sprints",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    projectId: uuid("project_id").notNull(),
    number: integer("number").notNull(),
    name: text("name").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    status: text("status", { enum: ["PLANNED", "ACTIVE", "CLOSED"] })
      .notNull()
      .default("PLANNED"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("sprints_project_number_unique").on(t.projectId, t.number),
    unique("sprints_id_org_unique").on(t.id, t.orgId),
    unique("sprints_id_project_unique").on(t.id, t.projectId),
    foreignKey({ name: "sprints_project_same_org_fk", columns: [t.projectId, t.orgId], foreignColumns: [projects.id, projects.orgId] }),
    index("sprints_org_project_status_idx").on(t.orgId, t.projectId, t.status),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    projectId: uuid("project_id").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    /** Untrusted plain text; never rendered as HTML or treated as instructions. */
    description: text("description"),
    status: text("status", { enum: ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"] })
      .notNull()
      .default("BACKLOG"),
    priority: text("priority", { enum: ["low", "medium", "high"] })
      .notNull()
      .default("medium"),
    agentId: uuid("agent_id"),
    cancelReason: text("cancel_reason"),
    contract: jsonb("contract"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    epicId: uuid("epic_id"),
    sprintId: uuid("sprint_id"),
    requiredCapabilities: text("required_capabilities")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (t) => [
    unique("tasks_project_number_unique").on(t.projectId, t.number),
    unique("tasks_id_org_unique").on(t.id, t.orgId),
    unique("tasks_id_project_org_unique").on(t.id, t.projectId, t.orgId),
    foreignKey({ name: "tasks_project_same_org_fk", columns: [t.projectId, t.orgId], foreignColumns: [projects.id, projects.orgId] }),
    foreignKey({ name: "tasks_agent_same_org_fk", columns: [t.agentId, t.orgId], foreignColumns: [agents.id, agents.orgId] }),
    foreignKey({ name: "tasks_epic_same_project_fk", columns: [t.epicId, t.projectId], foreignColumns: [epics.id, epics.projectId] }),
    foreignKey({ name: "tasks_sprint_same_project_fk", columns: [t.sprintId, t.projectId], foreignColumns: [sprints.id, sprints.projectId] }),
    check("tasks_required_capabilities_len_check", sql`cardinality(${t.requiredCapabilities}) <= 10`),
    index("tasks_org_project_status_idx").on(t.orgId, t.projectId, t.status),
  ],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    taskId: uuid("task_id").notNull(),
    workerId: uuid("worker_id").notNull(),
    status: text("status", { enum: ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "INTERRUPTED"] })
      .notNull()
      .default("QUEUED"),
    attempt: integer("attempt").notNull().default(1),
    queuedAt: ts("queued_at").notNull().defaultNow(),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    outputSummary: text("output_summary"),
    log: text("log"),
    errorCode: text("error_code"),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
  },
  (t) => [
    foreignKey({ name: "agent_runs_task_same_org_fk", columns: [t.taskId, t.orgId], foreignColumns: [tasks.id, tasks.orgId] }),
    foreignKey({ name: "agent_runs_worker_same_org_fk", columns: [t.workerId, t.orgId], foreignColumns: [workers.id, workers.orgId] }),
    index("agent_runs_status_queued_at_idx").on(t.status, t.queuedAt),
    index("agent_runs_org_task_idx").on(t.orgId, t.taskId, t.queuedAt),
    index("agent_runs_worker_active_idx").on(t.orgId, t.workerId, t.status),
  ],
);

export const projectAssignments = pgTable(
  "project_assignments",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    projectId: uuid("project_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    access: text("access", { enum: ["read", "write"] }).notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    foreignKey({
      name: "project_assignments_project_same_org_fk",
      columns: [t.projectId, t.orgId],
      foreignColumns: [projects.id, projects.orgId],
    }),
    index("project_assignments_org_user_idx").on(t.orgId, t.userId),
    index("project_assignments_project_idx").on(t.projectId),
  ],
);

export const taskDependencies = pgTable(
  "task_dependencies",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => orgs.id),
    projectId: uuid("project_id").notNull(),
    taskId: uuid("task_id").notNull(),
    dependsOnTaskId: uuid("depends_on_task_id").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.dependsOnTaskId] }),
    check("task_dependencies_no_self_dep", sql`${t.taskId} <> ${t.dependsOnTaskId}`),
    foreignKey({
      name: "task_dependencies_task_same_project_fk",
      columns: [t.taskId, t.projectId, t.orgId],
      foreignColumns: [tasks.id, tasks.projectId, tasks.orgId],
    }),
    foreignKey({
      name: "task_dependencies_depends_on_same_project_fk",
      columns: [t.dependsOnTaskId, t.projectId, t.orgId],
      foreignColumns: [tasks.id, tasks.projectId, tasks.orgId],
    }),
    index("task_dependencies_org_project_task_idx").on(t.orgId, t.projectId, t.taskId),
    index("task_dependencies_org_project_depends_on_idx").on(t.orgId, t.projectId, t.dependsOnTaskId),
  ],
);

export const allTables = {
  agent_runs: agentRuns,
  agents,
  audit_events: auditEvents,
  epics,
  milestones,
  oauth_login_states: oauthLoginStates,
  orgs,
  platform_admins: platformAdmins,
  project_assignments: projectAssignments,
  projects,
  provider_accounts: providerAccounts,
  rate_limit_hits: rateLimitHits,
  release_approvals: releaseApprovals,
  role_bindings: roleBindings,
  roles,
  sessions,
  sprints,
  task_dependencies: taskDependencies,
  tasks,
  user_allowlist: userAllowlist,
  users,
  workers,
} as const;
