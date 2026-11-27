import { z } from "zod";
import { ROLE_KEYS, type RoleKey } from "./rbac";

/**
 * P2-04 org members and role management.
 * Scoped strictly to the session's active org; identified by numeric GitHub user id.
 */
export const MemberSchema = z
  .object({
    githubUserId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    githubLogin: z.string().nullable(),
    roles: z.array(z.enum(ROLE_KEYS)),
  })
  .strict();

export type Member = {
  githubUserId: number;
  githubLogin: string | null;
  roles: RoleKey[];
};

export const MemberRoleChangeSchema = z
  .object({
    githubUserId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    role: z.enum(ROLE_KEYS),
  })
  .strict();

export type MemberRoleChange = z.infer<typeof MemberRoleChangeSchema>;

export const MemberRoleChangeResultSchema = z
  .object({
    changed: z.boolean(),
  })
  .strict();

export type MemberRoleChangeResult = z.infer<typeof MemberRoleChangeResultSchema>;
