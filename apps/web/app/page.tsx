import { redirect } from "next/navigation";
import { roleLabel } from "../lib/roles";
import { currentUser } from "../lib/server-api";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const me = await currentUser();
  if (!me) redirect("/login");
  return (
    <div>
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
    </div>
  );
}
