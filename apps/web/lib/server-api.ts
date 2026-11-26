import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { apiInternalUrl, SESSION_COOKIE } from "./api";

export interface Me {
  githubUserId: number;
  githubLogin: string | null;
  orgs: Array<{ slug: string; roles: string[] }>;
  activeOrg: { slug: string; roles: string[]; permissions: string[] } | null;
}

/**
 * Server-side GET to the api with the caller's session cookie. 401 → /login.
 * Returns null on 403 (no role / no permission) so pages can render an explanation instead of crashing.
 */
export async function apiGet<T>(path: string): Promise<T | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");
  const res = await fetch(`${apiInternalUrl()}${path}`, {
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    cache: "no-store",
  });
  if (res.status === 401) redirect("/login");
  if (res.status === 403) return null;
  if (!res.ok) throw new Error(`api ${res.status}`);
  return (await res.json()) as T;
}

export function can(me: Me | null, permission: string): boolean {
  return Boolean(me?.activeOrg?.permissions.includes(permission));
}
