import type { Member } from "@aidevteam/contracts";
import Link from "next/link";
import { apiGet, can, type Me } from "../../lib/server-api";
import { roleLabel } from "../../lib/roles";
import { AssignRoleForm, MemberRowActions } from "./forms";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const me = await apiGet<Me>("/auth/me");
  const members = await apiGet<Member[]>("/org/members");
  const canWrite = can(me, "member:write");

  return (
    <div>
      <p>
        <Link href="/">← Trang chủ</Link>
      </p>
      <h1>Thành viên {me?.activeOrg ? `— ${me.activeOrg.slug}` : ""}</h1>
      {members === null ? (
        <p role="status">Bạn chưa có quyền xem thành viên trong tổ chức này.</p>
      ) : (
        <>
          {canWrite ? <AssignRoleForm /> : null}
          {members.length === 0 ? (
            <p>Chưa có thành viên nào.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>GitHub ID</th>
                  <th>Login</th>
                  <th>Vai trò</th>
                  {canWrite ? <th>Thao tác</th> : null}
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.githubUserId} data-testid={`member-${m.githubUserId}`}>
                    <td>{m.githubUserId}</td>
                    <td>{m.githubLogin ?? "—"}</td>
                    <td>{m.roles.map(roleLabel).join(", ")}</td>
                    {canWrite ? (
                      <td>
                        <MemberRowActions githubUserId={m.githubUserId} roles={m.roles} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
