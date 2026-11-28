import type { ProviderAccount } from "@aidevteam/contracts";
import Link from "next/link";
import { apiGet, can, type Me } from "../../lib/server-api";
import { CreateProviderAccountForm, ProviderAccountRowActions } from "./forms";

export const dynamic = "force-dynamic";

export default async function ProviderAccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const showArchived = (await searchParams).archived === "true";
  const me = await apiGet<Me>("/auth/me");
  const data = await apiGet<{ items: ProviderAccount[] }>(`/provider-accounts?archived=${showArchived ? "true" : "false"}`);
  const canWrite = can(me, "provider_account:write");

  return (
    <div>
      <p>
        <Link href="/">← Trang chủ</Link>
      </p>
      <h1>Tài khoản provider {me?.activeOrg ? `— ${me.activeOrg.slug}` : ""}</h1>
      {data === null ? (
        <p role="status">Bạn chưa có quyền xem tài khoản provider trong tổ chức này.</p>
      ) : (
        <>
          {canWrite ? <CreateProviderAccountForm /> : null}
          <p>
            {showArchived ? <Link href="/provider-accounts">Ẩn mục đã lưu trữ</Link> : <Link href="/provider-accounts?archived=true">Hiện cả mục đã lưu trữ</Link>}
          </p>
          {data.items.length === 0 ? (
            <p>Chưa có tài khoản provider nào.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Tên</th>
                  <th>Provider</th>
                  <th>Tham chiếu secret</th>
                  <th>Trạng thái</th>
                  {canWrite ? <th>Thao tác</th> : null}
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a.slug} data-testid={`pa-${a.slug}`}>
                    <td>{a.slug}</td>
                    <td>{a.name}</td>
                    <td>{a.provider}</td>
                    <td>
                      <code>{a.secretRef}</code>
                    </td>
                    <td>{a.archivedAt ? "Đã lưu trữ" : "Đang dùng"}</td>
                    {canWrite ? <td>{a.archivedAt ? null : <ProviderAccountRowActions slug={a.slug} name={a.name} />}</td> : null}
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
