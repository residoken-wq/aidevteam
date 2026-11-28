import type { Approval } from "@aidevteam/contracts";
import Link from "next/link";
import { apiGet, type Me } from "../../lib/server-api";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const me = await apiGet<Me>("/auth/me");
  const data = await apiGet<{ items: Approval[] }>("/approvals");

  return (
    <div>
      <p>
        <Link href="/">← Trang chủ</Link>
      </p>
      <h1>Duyệt release {me?.activeOrg ? `— ${me.activeOrg.slug}` : ""}</h1>

      <p role="status">
        <strong>Chỉ hiển thị. Quyết định được thực hiện bằng comment /approve-* trên PR.</strong>
      </p>

      {data === null ? (
        <p role="status">Bạn chưa có quyền xem duyệt release trong tổ chức này.</p>
      ) : data.items.length === 0 ? (
        <p>Chưa có bản ghi duyệt</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Môi trường</th>
              <th>Quyết định</th>
              <th>Commit (target_sha)</th>
              <th>Digest</th>
              <th>Pipeline run</th>
              <th>Người duyệt (GitHub ID số)</th>
              <th>Thời điểm quyết định</th>
              <th>Thời điểm ghi</th>
              <th>Nguồn</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.id} data-testid={`approval-${item.id}`}>
                <td>{item.environment}</td>
                <td>{item.decision}</td>
                <td>
                  <code>{item.targetSha}</code>
                </td>
                <td>
                  <code>{item.releaseManifestDigest}</code>
                </td>
                <td>{item.pipelineRunId}</td>
                <td>{item.approverGithubUserId}</td>
                <td>{item.decidedAt}</td>
                <td>{item.recordedAt}</td>
                <td>
                  {item.sourceCommentUrl ? (
                    <a href={item.sourceCommentUrl} rel="noopener noreferrer" target="_blank">
                      Comment trên PR
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
