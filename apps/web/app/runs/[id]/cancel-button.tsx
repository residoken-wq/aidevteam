"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sendJson } from "../../../lib/api-errors";

export function CancelRunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  async function onCancel() {
    if (!window.confirm("Bạn có chắc chắn muốn hủy lượt chạy này?")) return;
    setCancelling(true);
    setError(null);
    const r = await sendJson("POST", `/api/runs/${encodeURIComponent(runId)}/cancel`);
    if (!r.ok) {
      setError(r.error);
      setCancelling(false);
      return;
    }
    setCancelling(false);
    router.refresh();
  }

  return (
    <div>
      <button type="button" onClick={onCancel} disabled={cancelling}>
        Hủy
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
