import { sql } from "drizzle-orm";
import { bigint, customType, foreignKey, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

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

export const allTables = {
  orgs,
  users,
  user_allowlist: userAllowlist,
  roles,
  role_bindings: roleBindings,
  sessions,
  audit_events: auditEvents,
  release_approvals: releaseApprovals,
} as const;
