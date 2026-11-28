"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sendJson } from "../../../lib/api-errors";
import { ConfirmDialog } from "../../../lib/confirm-dialog";

export function CancelRunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function handleConfirmCancel() {
    setCancelling(true);
    setError(null);
    const r = await sendJson("POST", `/api/runs/${encodeURIComponent(runId)}/cancel`);
    if (!r.ok) {
      setError(r.error);
      setCancelling(false);
      setConfirmOpen(false);
      return;
    }
    setCancelling(false);
    setConfirmOpen(false);
    router.refresh();
  }

  return (
    <div>
      <button type="button" onClick={() => setConfirmOpen(true)} disabled={cancelling}>
        Hủy
      </button>
      {error ? <p role="alert">{error}</p> : null}

      <ConfirmDialog
        open={confirmOpen}
        title="Xác nhận hủy lượt chạy"
        message={`Bạn có chắc chắn muốn hủy lượt chạy ${runId}?`}
        confirmLabel="Xác nhận hủy"
        cancelLabel="Không"
        loading={cancelling}
        onConfirm={handleConfirmCancel}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
