import { sql } from "drizzle-orm";
import { bigint, boolean, customType, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

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
  ],
);

export const allTables = {
  orgs,
  users,
  user_allowlist: userAllowlist,
  roles,
  role_bindings: roleBindings,
  sessions,
  audit_events: auditEvents,
  release_approvals: releaseApprovals,
  oauth_login_states: oauthLoginStates,
  rate_limit_hits: rateLimitHits,
  projects,
  provider_accounts: providerAccounts,
  workers,
  platform_admins: platformAdmins,
  agents,
} as const;
