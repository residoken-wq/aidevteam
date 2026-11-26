/**
 * Internal URL of the api service. Browsers never call it directly: /auth/* is proxied by
 * next.config rewrites (fixed at build time) and server components call it at runtime.
 * Default matches the compose service name.
 */
export function apiInternalUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env.API_INTERNAL_URL ?? "http://api:3001";
  const u = new URL(raw);
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("API_INTERNAL_URL must be http(s)");
  if (u.pathname !== "/" || u.search || u.hash) throw new Error("API_INTERNAL_URL must be an origin without path");
  return u.origin;
}

export const SESSION_COOKIE = "__Host-cc_session";
