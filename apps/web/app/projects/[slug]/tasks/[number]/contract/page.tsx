import type { TaskContractResponse, TaskPromptResponse } from "@aidevteam/contracts";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiGet, can, type Me } from "../../../../../../lib/server-api";
import { ContractEditForm } from "./contract-form";

export const dynamic = "force-dynamic";

const NUMBER_RE = /^[1-9][0-9]{0,8}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

export default async function TaskContractPage({
  params,
}: {
  params: Promise<{ slug: string; number: string }>;
}) {
  const { slug, number: numberStr } = await params;
  if (!SLUG_RE.test(slug) || !NUMBER_RE.test(numberStr)) notFound();

  const me = await apiGet<Me>("/auth/me");
  if (!can(me, "task:read")) {
    return (
      <div>
        <p>
          <Link href={`/projects/${encodeURIComponent(slug)}/tasks`}>← Task dự án</Link>
        </p>
        <p role="status">Bạn chưa có quyền xem hợp đồng task.</p>
      </div>
    );
  }

  const contractData = await apiGet<TaskContractResponse>(
    `/projects/${encodeURIComponent(slug)}/tasks/${numberStr}/contract`,
  );
  if (contractData === null) notFound();

  const promptData = await apiGet<TaskPromptResponse>(
    `/projects/${encodeURIComponent(slug)}/tasks/${numberStr}/contract/prompt`,
  );

  const canWrite = can(me, "task:write");

  return (
    <div>
      <p>
        <Link href={`/projects/${encodeURIComponent(slug)}/tasks`}>← Task dự án</Link>
      </p>
      <h1>Hợp đồng task #{numberStr} — {slug}</h1>

      <section aria-labelledby="contract-details-heading">
        <h2 id="contract-details-heading">Chi tiết hợp đồng</h2>
        {contractData.contract ? (
          <div>
            <p><strong>Mục tiêu:</strong> {contractData.contract.objective}</p>
            <h3>Tiêu chí nghiệm thu (Acceptance Criteria)</h3>
            <ul>
              {contractData.contract.acceptanceCriteria.map((ac) => (
                <li key={ac.id} data-testid={`ac-${ac.id}`}>
                  <strong>[{ac.id}]</strong> {ac.text}
                </li>
              ))}
            </ul>

            <h3>Đường dẫn được phép (Allowed Paths)</h3>
            {contractData.contract.allowedPaths.length > 0 ? (
              <ul>
                {contractData.contract.allowedPaths.map((p, idx) => (
                  <li key={idx}><code>{p}</code></li>
                ))}
              </ul>
            ) : (
              <p>Toàn bộ repository (trừ danh sách cấm).</p>
            )}

            <h3>Đường dẫn cấm riêng (Custom Forbidden Paths)</h3>
            {contractData.contract.forbiddenPaths.length > 0 ? (
              <ul>
                {contractData.contract.forbiddenPaths.map((p, idx) => (
                  <li key={idx}><code>{p}</code></li>
                ))}
              </ul>
            ) : (
              <p>Không có đường dẫn cấm bổ sung.</p>
            )}

            {contractData.contract.testCommands.length > 0 ? (
              <div>
                <h3>Lệnh kiểm tra (Test Commands)</h3>
                <ul>
                  {contractData.contract.testCommands.map((cmd, idx) => (
                    <li key={idx}><code>{JSON.stringify(cmd)}</code></li>
                  ))}
                </ul>
              </div>
            ) : null}

            {contractData.contract.outOfScope.length > 0 ? (
              <div>
                <h3>Ngoài phạm vi (Out of Scope)</h3>
                <ul>
                  {contractData.contract.outOfScope.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {contractData.contract.notes ? (
              <p><strong>Ghi chú:</strong> {contractData.contract.notes}</p>
            ) : null}
          </div>
        ) : (
          <p data-testid="no-contract-msg">Task chưa có hợp đồng (contract). Sử dụng biểu mẫu bên dưới để tạo.</p>
        )}

        <h3>Đường dẫn cấm hiệu lực (Effective Forbidden Paths)</h3>
        <ul>
          {contractData.effectiveForbiddenPaths.map((p, idx) => (
            <li key={idx}><code>{p}</code></li>
          ))}
        </ul>
      </section>

      {canWrite ? (
        <section aria-labelledby="contract-edit-heading">
          <h2 id="contract-edit-heading">Chỉnh sửa hợp đồng</h2>
          <ContractEditForm
            slug={slug}
            taskNumber={numberStr}
            initialContract={contractData.contract}
          />
        </section>
      ) : null}

      <section aria-labelledby="prompt-preview-heading">
        <h2 id="prompt-preview-heading">Xem trước Prompt cho Agent</h2>
        <pre data-testid="prompt-preview" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {promptData?.prompt ?? "(không có prompt)"}
        </pre>
      </section>
    </div>
  );
}
