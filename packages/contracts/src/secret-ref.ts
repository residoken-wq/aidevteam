import { z } from "zod";
import { redact } from "./redact";

/**
 * secret_ref — a pointer to a secret, never the secret itself (P1-07, CLAUDE.md §9).
 *
 * Accepted forms (proposal, DECISION_LOG D-2026-11-26-04):
 *   env:AIDEV_SECRET_<NAME>              — environment variable on the worker host. The fixed prefix means a
 *                                          ref can never point at Control Center's own variables
 *                                          (DATABASE_URL, GITHUB_OAUTH_CLIENT_SECRET, …) and lets the worker
 *                                          pass an env ALLOWLIST instead of the whole environment (router §6.2-1).
 *   file:/run/secrets/<name>             — Docker/compose secret file.
 * Control Center stores and displays refs only; it never resolves them in Release 0.1.
 */
const ENV_REF = /^env:AIDEV_SECRET_[A-Z0-9_]{1,64}$/;
const FILE_REF = /^file:\/run\/secrets\/[a-z0-9][a-z0-9._-]{0,63}$/;

export type SecretRefProblem = "secret_like" | "invalid_format";

/** Heuristic: does this look like a pasted credential rather than a reference? */
export function looksLikeSecret(value: string): boolean {
  if (redact(value) !== value) return true;
  // Long single token with mixed character classes (typical API keys) — over-reporting is acceptable here.
  if (/^\S{32,}$/.test(value) && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value)) return true;
  return false;
}

export function checkSecretRef(value: string): { ok: true } | { ok: false; problem: SecretRefProblem } {
  if (ENV_REF.test(value) || (FILE_REF.test(value) && !value.includes(".."))) return { ok: true };
  return { ok: false, problem: looksLikeSecret(value) ? "secret_like" : "invalid_format" };
}

/** Zod schema for API input. Error messages are fixed strings and NEVER contain the submitted value. */
export const SecretRefSchema = z.string().superRefine((value, ctx) => {
  const r = checkSecretRef(value);
  if (r.ok) return;
  ctx.addIssue({
    code: "custom",
    message:
      r.problem === "secret_like"
        ? "This looks like a secret value. Store the secret on the worker host and enter a reference (env:AIDEV_SECRET_… or file:/run/secrets/…)."
        : "secret_ref must be env:AIDEV_SECRET_<NAME> or file:/run/secrets/<name>",
    params: { problem: r.problem },
  });
});
