"use client";

import { useEffect, useRef, type ReactNode } from "react";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

/**
 * Accessible modal dialog with aria-modal="true", Esc key closing,
 * and default focus on the cancel ("Không") button.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Xác nhận",
  cancelLabel = "Không",
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
      // Focus cancel button by default
      cancelBtnRef.current?.focus();
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      style={{
        border: "1px solid #ccc",
        borderRadius: "8px",
        padding: "1.25rem",
        maxWidth: "480px",
        width: "90%",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
      }}
    >
      <h3 style={{ marginTop: 0 }}>{title}</h3>
      <div style={{ marginBottom: "1.25rem" }}>{message}</div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
        <button
          type="button"
          ref={cancelBtnRef}
          onClick={onCancel}
          disabled={loading}
          autoFocus
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
        >
          {loading ? "Đang xử lý..." : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
