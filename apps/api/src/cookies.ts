import type { Response } from "express";

/** `__Host-` prefix: browser enforces Secure, Path=/ and no Domain attribute. */
export const SESSION_COOKIE = "__Host-cc_session";
export const OAUTH_STATE_COOKIE = "__Host-cc_oauth_state";

/** Minimal Cookie header parser (no dependency). Ignores malformed pairs; first occurrence wins. */
export function parseCookies(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!name || out.has(name)) continue;
    try {
      out.set(name, decodeURIComponent(value));
    } catch {
      // ignore undecodable values
    }
  }
  return out;
}

export function setSecureCookie(res: Response, name: string, value: string, maxAgeMs: number): void {
  res.cookie(name, value, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: maxAgeMs });
}

export function clearSecureCookie(res: Response, name: string): void {
  res.clearCookie(name, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
}
