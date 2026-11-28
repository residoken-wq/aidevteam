"use client";

import type { TaskContract } from "@aidevteam/contracts";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { sendJson } from "../../../../../../lib/api-errors";

interface ContractEditFormProps {
  slug: string;
  taskNumber: string;
  initialContract: TaskContract | null;
}

const DEFAULT_SKELETON: TaskContract = {
  version: 1,
  objective: "",
  acceptanceCriteria: [{ id: "AC-1", text: "" }],
  allowedPaths: [],
  forbiddenPaths: [],
  testCommands: [["pnpm", "test"]],
  outOfScope: [],
  notes: "",
};

export function ContractEditForm({ slug, taskNumber, initialContract }: ContractEditFormProps) {
  const router = useRouter();
  const [jsonText, setJsonText] = useState(() =>
    JSON.stringify(initialContract ?? DEFAULT_SKELETON, null, 2),
  );
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<Array<{ path?: string; message?: string }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIssues(null);
    setSuccess(false);

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      setError("Cú pháp JSON không hợp lệ.");
      return;
    }

    setBusy(true);
    const r = await sendJson<TaskContract>(
      "PUT",
      `/api/projects/${encodeURIComponent(slug)}/tasks/${taskNumber}/contract`,
      parsed,
    );
    setBusy(false);

    if (!r.ok) {
      setError(r.error);
      if (r.issues && r.issues.length > 0) {
        setIssues(r.issues);
      }
      return;
    }

    setSuccess(true);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} aria-label="Biểu mẫu hợp đồng task">
      <div>
        <label htmlFor="contract-json">Nội dung JSON hợp đồng (TaskContract):</label>
        <textarea
          id="contract-json"
          name="contractJson"
          rows={16}
          cols={80}
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          disabled={busy}
          style={{ width: "100%", fontFamily: "monospace", fontSize: "0.9rem" }}
        />
      </div>

      <div style={{ marginTop: "0.5rem" }}>
        <button type="submit" disabled={busy}>
          {busy ? "Đang lưu..." : "Lưu hợp đồng"}
        </button>
      </div>

      {success ? <p role="status" style={{ color: "green" }}>Lưu hợp đồng thành công.</p> : null}

      {error ? (
        <div role="alert" style={{ color: "red", marginTop: "0.5rem" }}>
          <p>{error}</p>
          {issues ? (
            <ul>
              {issues.map((issue, idx) => (
                <li key={idx}>
                  {issue.path ? <strong>{issue.path}: </strong> : null}
                  {issue.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
