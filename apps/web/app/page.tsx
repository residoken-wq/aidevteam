import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { apiInternalUrl, SESSION_COOKIE } from "../lib/api";

export const dynamic = "force-dynamic";

interface Me {
  githubUserId: number;
  githubLogin: string | null;
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
      <p>Release 0.1 — chưa có chức năng nghiệp vụ. Quyền thao tác được cấp qua RBAC (P1-06).</p>
      <form method="post" action="/auth/logout">
        <button type="submit">Đăng xuất</button>
      </form>
    </main>
  );
}
