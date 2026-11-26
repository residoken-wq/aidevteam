/**
 * Redaction for logs, audit metadata and error messages (CLAUDE.md §9: token, email, phone, CCCD).
 * Heuristic and intentionally aggressive: over-redaction is acceptable, leaks are not.
 * Not a guarantee — callers must still avoid logging secrets in the first place.
 */
export const REDACTED = "[REDACTED]";

interface Rule {
  name: string;
  re: RegExp;
  replace?: (match: string, ...groups: string[]) => string;
}

const RULES: Rule[] = [
  { name: "pem_private_key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  // scheme://user:password@host → keep scheme and user, hide password
  { name: "url_credentials", re: /\b([a-z][a-z0-9+.-]*:\/\/[^:/\s@]+:)[^@\s/]+@/gi, replace: (_m, p1) => `${p1}${REDACTED}@` },
  { name: "bearer", re: /\b(Bearer|token)\s+[A-Za-z0-9._~+/-]{8,}=*/gi, replace: (_m, p1) => `${p1} ${REDACTED}` },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { name: "github_token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { name: "anthropic_key", re: /\bsk-ant-[A-Za-z0-9_-]{16,}/g },
  { name: "generic_sk_key", re: /\bsk-[A-Za-z0-9_-]{20,}/g },
  { name: "slack_token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { name: "aws_access_key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: "google_api_key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  // key=value / key: value for sensitive key names
  {
    name: "sensitive_assignment",
    re: /\b(password|passwd|pwd|secret|client_secret|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key)(["']?\s*[:=]\s*["']?)[^\s"',;&]+/gi,
    replace: (_m, k, sep) => `${k}${sep}${REDACTED}`,
  },
  { name: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // Vietnamese citizen id (CCCD): exactly 12 digits
  { name: "cccd", re: /(?<![\w-])\d{12}(?![\w-])/g },
  // Vietnamese phone numbers: 0xxxxxxxxx / +84xxxxxxxxx / 84xxxxxxxxx (9–10 digits after the prefix), optional separators
  { name: "phone_vn", re: /(?<![\w+-])(?:\+?84|0)(?:[\s.-]?\d){9,10}(?![\w-])/g },
];

export function redact(text: string): string {
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.re, (match: string, ...groups: unknown[]) =>
      rule.replace ? rule.replace(match, ...(groups.filter((g) => typeof g === "string") as string[])) : REDACTED,
    );
  }
  return out;
}

const SENSITIVE_KEY = /^(password|passwd|pwd|secret|client_secret|token|access_token|refresh_token|api_?key|authorization|cookie|set-cookie|private_?key|code_verifier|session_token)$/i;

/**
 * Deep-redact any JSON-like value: string values are passed through redact(); values under sensitive keys are
 * replaced entirely. Depth-limited to stop pathological input; cycles become "[Circular]".
 */
export function redactDeep(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (depth > 8) return "[Truncated]";
  if (typeof value === "string") return redact(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1, seen));
  if (value instanceof Error) return { name: value.name, message: redact(value.message) };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactDeep(v, depth + 1, seen);
  }
  return out;
}
