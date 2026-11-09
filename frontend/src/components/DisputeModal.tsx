import { useEffect, useRef, useState } from "react";
import type { Errand } from "../types/errand";
import { STATUS_LABELS } from "../types/errand";
import { formatCredits } from "../utils/errand-format";
import "./errand-buttons.css";
import "./ErrandPreviewModal.css";
import "./DisputeModal.css";

const REASON_MAXLENGTH = 300;

// Requester-facing dispute dialog: collects a reason before raising a dispute to the admins.
export default function DisputeModal({
  errand,
  isBusy = false,
  error = "",
  onSubmit,
  onClose,
}: {
  errand: Errand;
  isBusy?: boolean;
  error?: string;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const trimmed = reason.trim();

  useEffect(() => {
    textareaRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isBusy) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, isBusy]);

  function submit() {
    if (!trimmed || isBusy) return;
    onSubmit(trimmed);
  }

  return (
    <div className="errand-modal-backdrop" onClick={() => !isBusy && onClose()}>
      <div
        className="errand-modal dispute-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispute-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="dispute-modal-title">Dispute this errand</h2>
        <p className="dispute-modal-intro">
          Having an issue (for example, the courier has not delivered or delivered the wrong item)? Describe the problem and it
          will be raised to an administrator, who will review it and get back to you. Your credits
          stay held until the dispute is resolved.
        </p>

        {/* The courier's username will be shown here once user profile lookup is available
            (the errand currently stores only courierId). */}
        <div className="dispute-modal-details">
          <p className="dispute-modal-details-title">Errand details</p>
          <dl className="dispute-modal-facts">
            <div><dt>Supplier</dt><dd>{errand.supplier.name}</dd></div>
            <div><dt>Drop-off</dt><dd>{errand.dropoff}</dd></div>
            <div><dt>Description</dt><dd>{errand.description}</dd></div>
            <div><dt>Credits</dt><dd>{formatCredits(errand.credit)}</dd></div>
            <div><dt>Status</dt><dd>{STATUS_LABELS[errand.status]}</dd></div>
          </dl>
        </div>

        <textarea
          id="dispute-reason"
          ref={textareaRef}
          className="dispute-modal-textarea"
          value={reason}
          maxLength={REASON_MAXLENGTH}
          rows={4}
          placeholder="Tell us what went wrong…"
          disabled={isBusy}
          onChange={(event) => setReason(event.target.value)}
        />
        <div className="dispute-modal-count">{reason.length}/{REASON_MAXLENGTH}</div>

        {error && <p className="errand-modal-error" role="alert">{error}</p>}

        <div className="errand-modal-actions">
          <button type="button" className="errand-btn" onClick={onClose} disabled={isBusy}>Cancel</button>
          <button
            type="button"
            className="errand-btn errand-btn-warning"
            onClick={submit}
            disabled={isBusy || !trimmed}
          >
            {isBusy ? "Submitting…" : "Submit dispute"}
          </button>
        </div>
      </div>
    </div>
  );
}
