import { useEffect, useRef } from "react";
import type { Errand } from "../types/errand";
import { STATUS_LABELS } from "../types/errand";
import { formatCredits, timeLeft } from "../utils/errand-format";
import { SupplierThumb } from "./ErrandCard";
import "./errand-buttons.css";
import "./ErrandPreviewModal.css";

//Errand preview pop-up
export default function ErrandPreviewModal({
  errand,
  now,
  isOwn,
  isBusy = false,
  error = "",
  onAccept,
  onClose,
}: {
  errand: Errand;
  now: number;
  isOwn: boolean;
  isBusy?: boolean;
  error?: string;
  onAccept?: () => void;
  onClose: () => void;
}) {
  const primaryRef = useRef<HTMLButtonElement>(null);
  const canAccept = errand.status === "OPEN" && !isOwn && new Date(errand.expiresAt).getTime() > now;

  useEffect(() => {
    primaryRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isBusy) onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, isBusy]);

  return (
    <div className="errand-modal-backdrop" onClick={() => !isBusy && onClose()}>
      <div
        className="errand-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="errand-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="errand-modal-supplier">
          <SupplierThumb errand={errand} className="errand-modal-image" />
          <div>
            <h2 id="errand-modal-title">{errand.supplier.name}</h2>
            <p>{errand.supplier.building}{errand.supplier.address ? ` · ${errand.supplier.address}` : ""}</p>
          </div>
        </div>

        <dl className="errand-modal-facts">
          <div><dt>Reward</dt><dd>{formatCredits(errand.credit)}</dd></div>
          <div><dt>Destination</dt><dd>{errand.dropoff}</dd></div>
          <div><dt>Notes to courier</dt><dd>{errand.description}</dd></div>
          <div><dt>Status</dt><dd>{STATUS_LABELS[errand.status]}</dd></div>
          {errand.status === "OPEN" && <div><dt>Expires</dt><dd>{timeLeft(errand.expiresAt, now)}</dd></div>}
        </dl>

        {isOwn && onAccept && <p className="errand-modal-hint">This is your own errand, so you cannot accept it.</p>}
        {error && <p className="errand-modal-error" role="alert">{error}</p>}

        <div className="errand-modal-actions">
          {onAccept ? (
            <>
              <button type="button" className="errand-btn" onClick={onClose} disabled={isBusy}>Cancel</button>
              <button
                ref={primaryRef}
                type="button"
                className="errand-btn errand-btn-primary"
                onClick={onAccept}
                disabled={isBusy || !canAccept}
              >
                {isBusy ? "Accepting…" : "Accept"}
              </button>
            </>
          ) : (
            <button ref={primaryRef} type="button" className="errand-btn" onClick={onClose}>Close</button>
          )}
        </div>
      </div>
    </div>
  );
}
