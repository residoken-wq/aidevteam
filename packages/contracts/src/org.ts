import { z } from "zod";
import { ListQuerySchema, SlugSchema } from "./common";

/** Org names: 1-200 characters after trimming (matches the orgs.name CHECK in migration 0001). */
export const OrgNameSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(z.string().min(1, "name is required").max(200, "name: at most 200 characters"));

export const OrgCreateSchema = z.object({ slug: SlugSchema, name: OrgNameSchema }).strict();
export type OrgCreate = z.infer<typeof OrgCreateSchema>;

/** Only the name can change; the slug is an identifier used in URLs, CLI and audit. */
export const OrgUpdateSchema = z.object({ name: OrgNameSchema }).strict();
export type OrgUpdate = z.infer<typeof OrgUpdateSchema>;

export const OrgSchema = z.object({
  slug: z.string(),
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
});
export type Org = z.infer<typeof OrgSchema>;

export const OrgListQuerySchema = ListQuerySchema;
