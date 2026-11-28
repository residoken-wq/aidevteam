import { z } from "zod";
import { DescriptionSchema, ListQuerySchema, NameSchema, SlugSchema } from "./common";
import { SecretRefSchema } from "./secret-ref";

/**
 * Provider account contracts (P2-07). Holds a secret_ref — never a credential. Requests are .strict():
 * org id in the body is rejected. A pasted credential fails SecretRefSchema with problem "secret_like".
 * Release 0.1 never contacts the provider (no "test connection").
 */
/** "openai" covers OpenAI Codex (D-2026-11-26-11). */
export const PROVIDERS = ["anthropic", "openai", "google", "github", "other"] as const;
export const ProviderSchema = z.enum(PROVIDERS);

export const LICENSE_STATUSES = ["approved", "unverified", "prohibited"] as const;
export const LicenseStatusSchema = z.enum(LICENSE_STATUSES);
export type LicenseStatus = z.infer<typeof LicenseStatusSchema>;

export const ProviderAccountLicenseChangeSchema = z
  .object({
    licenseStatus: LicenseStatusSchema,
  })
  .strict();
export type ProviderAccountLicenseChange = z.infer<typeof ProviderAccountLicenseChangeSchema>;

export const ProviderAccountCreateSchema = z
  .object({
    slug: SlugSchema,
    name: NameSchema,
    provider: ProviderSchema,
    secretRef: SecretRefSchema,
    description: DescriptionSchema.optional(),
  })
  .strict();

export const ProviderAccountUpdateSchema = z
  .object({
    name: NameSchema.optional(),
    secretRef: SecretRefSchema.optional(),
    description: DescriptionSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => v.name !== undefined || v.secretRef !== undefined || v.description !== undefined, "nothing to update");

export const ProviderAccountSchema = z
  .object({
    slug: SlugSchema,
    name: z.string(),
    provider: ProviderSchema,
    secretRef: z.string(),
    description: z.string().nullable(),
    licenseStatus: LicenseStatusSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
    archivedAt: z.string().nullable(),
  })
  .strict();

export const ProviderAccountListQuerySchema = ListQuerySchema;

export type ProviderAccount = z.infer<typeof ProviderAccountSchema>;
