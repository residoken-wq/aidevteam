import Link from "next/link";
import { redirect } from "next/navigation";
import { roleLabel } from "../../lib/roles";
import { currentUser } from "../../lib/server-api";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const me = await currentUser();
  if (!me) {
    redirect("/login");
  }

  const isPlatformAdmin = Boolean(me.platformPermissions && me.platformPermissions.length > 0);

  return (
    <div>
      <p>
        <Link href="/">← Trang chủ</Link>
      </p>
      <h1>Hồ sơ</h1>

      <dl>
        <dt>GitHub User ID</dt>
        <dd data-testid="profile-github-id">{me.githubUserId}</dd>

        <dt>GitHub Login</dt>
        <dd data-testid="profile-github-login">{me.githubLogin ?? "—"}</dd>

        <dt>Tổ chức đang dùng</dt>
        <dd data-testid="profile-active-org">
          {me.activeOrg
            ? `${me.activeOrg.slug} (${me.activeOrg.roles.map(roleLabel).join(", ")})`
            : "—"}
        </dd>

        <dt>Quyền quản trị nền tảng</dt>
        <dd data-testid="profile-platform-admin">{isPlatformAdmin ? "Có" : "Không"}</dd>

        <dt>Tổ chức được gán vai trò</dt>
        <dd data-testid="profile-orgs">
          {me.orgs.length === 0 ? (
            <p>Chưa được gán vai trò trong tổ chức nào.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">Tổ chức</th>
                  <th scope="col">Vai trò</th>
                </tr>
              </thead>
              <tbody>
                {me.orgs.map((o) => (
                  <tr key={o.slug}>
                    <td>{o.slug}</td>
                    <td>{o.roles.map(roleLabel).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </dd>
      </dl>
    </div>
  );
}
