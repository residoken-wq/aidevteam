import type { Run } from "@aidevteam/contracts";
import Link from "next/link";
import { CancelRunButton } from "./cancel-button";

export function RunDetail({ run, canCancel }: { run: Run; canCancel: boolean }) {
  return (
    <div>
      <p>
        <Link href={`/projects/${encodeURIComponent(run.projectSlug)}/tasks`}>← Task dự án</Link>
        {" · "}
        <Link href={`/projects/${encodeURIComponent(run.projectSlug)}/tasks/${run.taskNumber}/runs`}>
          Lịch sử chạy task #{run.taskNumber}
        </Link>
      </p>

      <h1>
        Lượt chạy #{run.attempt} — Task #{run.taskNumber} ({run.projectSlug})
      </h1>

      <section aria-label="Thông tin lượt chạy">
        <dl>
          <dt>ID</dt>
          <dd>
            <code>{run.id}</code>
          </dd>
          <dt>Trạng thái</dt>
          <dd data-testid="run-status">
            <strong>{run.status}</strong>
          </dd>
          <dt>Worker</dt>
          <dd data-testid="run-worker">{run.workerSlug}</dd>
          <dt>Lần thử (attempt)</dt>
          <dd data-testid="run-attempt">#{run.attempt}</dd>
          <dt>Xếp hàng lúc</dt>
          <dd>{run.queuedAt}</dd>
          <dt>Bắt đầu lúc</dt>
          <dd>{run.startedAt ?? "—"}</dd>
          <dt>Kết thúc lúc</dt>
          <dd>{run.finishedAt ?? "—"}</dd>
          <dt>Mã lỗi</dt>
          <dd data-testid="run-error-code">{run.errorCode ?? "—"}</dd>
        </dl>
      </section>

      {canCancel ? <CancelRunButton runId={run.id} /> : null}

      <section aria-label="Kết quả tóm tắt">
        <h2>Kết quả tóm tắt</h2>
        <div data-testid="run-summary" style={{ whiteSpace: "pre-wrap" }}>
          {run.outputSummary ?? "(không có)"}
        </div>
      </section>

      <section aria-label="Log lượt chạy">
        <h2>Log</h2>
        <pre
          data-testid="run-log"
          style={{
            background: "#f5f5f5",
            padding: "0.5rem",
            border: "1px solid #ccc",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          {run.log ?? "(không có log)"}
        </pre>
      </section>
    </div>
  );
}
