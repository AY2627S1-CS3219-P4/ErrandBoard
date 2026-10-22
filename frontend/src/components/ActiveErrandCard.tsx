import type { ReactNode } from "react";
import { IoBagHandleOutline, IoPersonCircleOutline } from "react-icons/io5";
import type { Errand, ErrandAction } from "../types/errand";
import { STATUS_LABELS } from "../types/errand";
import { formatCredits, timeLeft } from "../utils/errand-format";
import { SupplierThumb } from "./ErrandCard";
import "./errand-buttons.css";
import "./ActiveErrandCard.css";

/**
 * Role-specific active errand card
 * Requester: cancel (OPEN only) and mark completed (PENDING_COMPLETION only).
 * Courier: cancel (ACCEPTED only, picker up (ACCEPTED only), delivered (PICKED_UP only).
 * grey out buttons that are not applicable. (should not be hidden here)
 */
export default function ActiveErrandCard({
  errand,
  role,
  now,
  busyAction,
  error = "",
  onAction,
  onOpen,
}: {
  errand: Errand;
  role: "requester" | "courier";
  now: number;
  busyAction: ErrandAction | null;
  error?: string;
  onAction: (action: ErrandAction) => void;
  onOpen: () => void;
}) {
  const { status } = errand;
  const busy = busyAction !== null;
  const confirmOpen = errand.confirmBy ? new Date(errand.confirmBy).getTime() > now : true;

  // Icon rules: F28.2.3/4 (requester) and F28.2.6/7 (courier).
  // The user service has no profile lookup yet, so "user icon" is a generic avatar for now.
  let icon: ReactNode;
  let iconLabel: string;
  if (role === "requester") {
    if (status === "OPEN") {
      icon = <IoBagHandleOutline aria-hidden="true" />;
      iconLabel = "Waiting for a courier";
    } else {
      icon = <IoPersonCircleOutline aria-hidden="true" />;
      iconLabel = "Courier assigned";
    }
  } else if (status === "ACCEPTED") {
    icon = <SupplierThumb errand={errand} className="active-errand-icon active-errand-icon-supplier" />;
    iconLabel = errand.supplier.name;
  } else {
    icon = <IoPersonCircleOutline aria-hidden="true" />;
    iconLabel = "Requester";
  }

  let hint = "";
  if (role === "requester") {
    if (status === "OPEN") hint = `Waiting for a courier · ${timeLeft(errand.expiresAt, now)}`;
    else if (status === "ACCEPTED") hint = "A courier has accepted your errand";
    else if (status === "PICKED_UP") hint = "Your item is on its way";
    else if (status === "PENDING_COMPLETION" && errand.confirmBy) {
      hint = confirmOpen
        ? `Confirm receipt · ${timeLeft(errand.confirmBy, now)}`
        : "Confirmation window has closed";
    }
  } else if (status === "ACCEPTED") hint = `Pick up from ${errand.supplier.name}`;
  else if (status === "PICKED_UP") hint = `Deliver to ${errand.dropoff}`;
  else if (status === "PENDING_COMPLETION") hint = "Waiting for the requester to confirm";

  const label = (action: ErrandAction, idle: string, working: string) => (busyAction === action ? working : idle);

  return (
    <li className="active-errand">
      <button type="button" className="active-errand-main" onClick={onOpen}>
        <span
          className={
            role === "courier" && status === "ACCEPTED"
              ? "active-errand-icon-slot active-errand-icon-slot-supplier"
              : "active-errand-icon-slot"
          }
          role="img"
          aria-label={iconLabel}
        >
          {icon}
        </span>
        <span className="active-errand-body">
          <span className="active-errand-top">
            <strong className="active-errand-name">{errand.supplier.name}</strong>
            <span className={`active-errand-status active-errand-status-${status.toLowerCase()}`}>
              {STATUS_LABELS[status]}
            </span>
          </span>
          <span className="active-errand-route">{errand.supplier.building} → {errand.dropoff}</span>
          <span className="active-errand-description">{errand.description}</span>
          <span className="active-errand-meta">
            {formatCredits(errand.credit)}{hint && ` · ${hint}`}
          </span>
        </span>
      </button>

      {error && <p className="active-errand-error" role="alert">{error}</p>}

      <div className="active-errand-actions">
        {role === "requester" ? (
          <>
            <button
              type="button"
              className="errand-btn errand-btn-danger"
              disabled={busy || status !== "OPEN"}
              onClick={() => onAction("cancel")}
            >
              {label("cancel", "Cancel errand", "Cancelling…")}
            </button>
            <button
              type="button"
              className="errand-btn errand-btn-primary"
              disabled={busy || status !== "PENDING_COMPLETION" || !confirmOpen}
              onClick={() => onAction("complete")}
            >
              {label("complete", "Mark completed", "Confirming…")}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="errand-btn errand-btn-danger"
              disabled={busy || status !== "ACCEPTED"}
              onClick={() => onAction("courier-cancel")}
            >
              {label("courier-cancel", "Cancel errand", "Cancelling…")}
            </button>
            <button
              type="button"
              className="errand-btn"
              disabled={busy || status !== "ACCEPTED"}
              onClick={() => onAction("pickup")}
            >
              {label("pickup", "Picked up", "Updating…")}
            </button>
            <button
              type="button"
              className="errand-btn errand-btn-primary"
              disabled={busy || status !== "PICKED_UP"}
              onClick={() => onAction("deliver")}
            >
              {label("deliver", "Delivered", "Updating…")}
            </button>
          </>
        )}
      </div>
    </li>
  );
}
