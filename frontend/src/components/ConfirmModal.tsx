import { useEffect, useRef, type ReactNode } from "react";
import "./ConfirmModal.css";

export default function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  variant = "confirm",
  busy = false,
  eyebrow = "CONFIRM ACTION",
  onConfirm,
  onClose,
}: {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  variant?: "confirm" | "acknowledge";
  busy?: boolean;
  eyebrow?: string;
  onConfirm?: () => void;
  onClose: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, busy]);

  const isAcknowledge = variant === "acknowledge";

  return (
    <div
      className="confirm-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}
    >
      <section className="confirm-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id="confirm-modal-title">{title}</h2>
        {message && <p className="confirm-modal-message">{message}</p>}
        <div className="confirm-modal-actions">
          {!isAcknowledge && (
            <button className="confirm-modal-cancel" type="button" onClick={onClose} disabled={busy}>
              {cancelLabel}
            </button>
          )}
          <button
            ref={confirmRef}
            className={`confirm-modal-confirm ${tone === "danger" ? "confirm-modal-danger" : ""}`}
            type="button"
            onClick={() => (isAcknowledge ? onClose() : onConfirm?.())}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
