import type { Org } from "@aidevteam/contracts";
import Link from "next/link";
import { apiGet, canPlatform, type Me } from "../../../lib/server-api";
import { CreateOrgForm, OrgRowActions } from "./forms";

export const dynamic = "force-dynamic";

export default async function PlatformOrgsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const showArchived = (await searchParams).archived === "true";
  const me = await apiGet<Me>("/auth/me");
  const data = await apiGet<{ items: Org[] }>(`/platform/orgs?archived=${showArchived ? "true" : "false"}&limit=100`);
  const canWrite = canPlatform(me, "platform:org:write");

  return (
    <div>
      <p>
        <Link href="/">← Trang chủ</Link>
      </p>
      <h1>Quản trị tổ chức</h1>
      {data === null ? (
        <p role="status">Chỉ quản trị viên nền tảng mới xem được trang này.</p>
      ) : (
        <>
          <p>
            <small>
              Quản trị nền tảng chỉ quản lý danh sách tổ chức, không xem được dữ liệu bên trong. Gán role cho người dùng vẫn làm bằng CLI vận hành.
            </small>
          </p>
          {canWrite ? <CreateOrgForm /> : null}
          <p>{showArchived ? <Link href="/platform/orgs">Ẩn mục đã lưu trữ</Link> : <Link href="/platform/orgs?archived=true">Hiện cả mục đã lưu trữ</Link>}</p>
          {data.items.length === 0 ? (
            <p>Chưa có tổ chức nào.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Mã</th>
                  <th>Tên</th>
                  <th>Trạng thái</th>
                  {canWrite ? <th>Thao tác</th> : null}
                </tr>
              </thead>
              <tbody>
                {data.items.map((o) => (
                  <tr key={o.slug} data-testid={`org-${o.slug}`}>
                    <td>{o.slug}</td>
                    <td>{o.name}</td>
                    <td>{o.archivedAt ? "Đã lưu trữ" : "Đang hoạt động"}</td>
                    {canWrite ? (
                      <td>
                        <OrgRowActions slug={o.slug} name={o.name} archived={o.archivedAt !== null} />
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
