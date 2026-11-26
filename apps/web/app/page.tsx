import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { apiInternalUrl, SESSION_COOKIE } from "../lib/api";
import { roleLabel } from "../lib/roles";

export const dynamic = "force-dynamic";

interface Me {
  githubUserId: number;
  githubLogin: string | null;
  orgs: Array<{ slug: string; roles: string[] }>;
  activeOrg: { slug: string; roles: string[]; permissions: string[] } | null;
}

async function currentUser(): Promise<Me | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const res = await fetch(`${apiInternalUrl()}/auth/me`, {
    headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` },
    cache: "no-store",
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error("failed to load session");
  return (await res.json()) as Me;
}

export default async function HomePage() {
  const me = await currentUser();
  if (!me) redirect("/login");
  return (
    <main>
      <h1>AI Dev Team Control Center</h1>
      <p>
        Đã đăng nhập: <strong>{me.githubLogin ?? `GitHub #${me.githubUserId}`}</strong>
      </p>

      {me.orgs.length === 0 ? (
        <p role="status">Tài khoản chưa được cấp quyền trong tổ chức nào. Liên hệ quản trị viên để được gán role.</p>
      ) : me.activeOrg ? (
        <p>
          Tổ chức: <strong>{me.activeOrg.slug}</strong> — vai trò: {me.activeOrg.roles.map(roleLabel).join(", ")}
        </p>
      ) : (
        <p role="status">Bạn thuộc nhiều tổ chức. Chọn tổ chức để làm việc:</p>
      )}

      {me.orgs.length > 1 ? (
        <ul>
          {me.orgs.map((o) => (
            <li key={o.slug}>
              <form method="post" action="/auth/active-org">
                <input type="hidden" name="orgSlug" value={o.slug} />
                <button type="submit" disabled={me.activeOrg?.slug === o.slug}>
                  {o.slug} ({o.roles.map(roleLabel).join(", ")})
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : null}

      {me.activeOrg ? (
        <nav>
          <a href="/projects">Dự án</a> · <a href="/provider-accounts">Tài khoản provider</a>
        </nav>
      ) : null}

      <form method="post" action="/auth/logout">
        <button type="submit">Đăng xuất</button>
      </form>
    </main>
  );
}
