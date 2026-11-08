import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import {
  describeError,
  listDisputes,
  resolveDisputeRefund,
  resolveDisputeTransfer,
} from "../api/errands";
import { formatCredits, timeAgo } from "../utils/errand-format";
import type { Errand } from "../types/errand";
import { useNow } from "../hooks/useNow";
import "./AdminDashboard.css";
import "./AccountAdministration.css";
import "./DisputeManagement.css";

type Outcome = "refund" | "transfer";

export default function DisputeManagement() {
  const { user } = useAuth();
  const now = useNow();
  const [disputes, setDisputes] = useState<Errand[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null); // row whose details are open

  useEffect(() => {
    const controller = new AbortController();
    listDisputes(controller.signal)
      .then((result) => {
        setDisputes(result);
        setError("");
        setHasLoaded(true);
      })
      .catch((cause) => {
        if (controller.signal.aborted) return;
        setError(describeError(cause));
        setHasLoaded(true);
      });
    return () => controller.abort();
  }, [refreshTick]);

  async function resolve(errand: Errand, outcome: Outcome) {
    const who = outcome === "refund" ? "refund the requester" : "transfer the credit to the courier";
    if (!window.confirm(`Resolve this dispute and ${who}? This cannot be undone.`)) return;

    setResolving(errand._id);
    setError("");
    try {
      await (outcome === "refund" ? resolveDisputeRefund(errand._id) : resolveDisputeTransfer(errand._id));
      setDisputes((current) => current.filter((item) => item._id !== errand._id));
      // a lightweight alert keeps the confirmation out of the table, which looked cramped
      window.alert(
        outcome === "refund"
          ? `Dispute resolved — ${formatCredits(errand.credit)} refunded to the requester.`
          : `Dispute resolved — ${formatCredits(errand.credit)} transferred to the courier.`,
      );
    } catch (cause) {
      setError(describeError(cause));
      // a 409 means our copy is stale (already resolved elsewhere) — reload the queue.
      setRefreshTick((tick) => tick + 1);
    } finally {
      setResolving(null);
    }
  }

  return (
    <main className="admin-dashboard account-administration-page dispute-management-page">
      <Link className="admin-back-button" to="/admin"><span aria-hidden="true">←</span>Back to dashboard</Link>
      <div className="admin-page-heading">
        <div>
          <p className="eyebrow">ERRANDBOARD / ADMIN</p>
          <h1>Errand oversight</h1>
          <p>Review platform errands and resolve disputes.</p>
        </div>
        <span className="role-badge"><span className="role-dot" />{user?.accountType}</span>
      </div>

      <nav className="oversight-tabs" aria-label="Errand oversight views">
        <button type="button" className="oversight-tab oversight-tab-active" aria-current="page">Disputes</button>
        {/* Future tabs (e.g. an all-errands overview) slot in here. */}
      </nav>

      <section className="account-admin-panel" aria-labelledby="dispute-list-title">
        <div className="section-heading account-admin-heading">
          <div>
            <h2 id="dispute-list-title">Open disputes</h2>
          </div>
          <div className="account-summary"><strong>{disputes.length}</strong><span>awaiting review</span></div>
        </div>

        {error && <p className="account-error" role="alert">{error}</p>}

        {!hasLoaded ? (
          <p className="account-empty-state">Loading disputes…</p>
        ) : disputes.length === 0 ? (
          <p className="account-empty-state">No open disputes.</p>
        ) : (
          <div className="account-table-wrap">
            <table className="account-table dispute-table">
              <thead>
                <tr>
                  <th>Errand</th>
                  <th>Parties</th>
                  <th>Reason</th>
                  <th>Disputed</th>
                  <th>Credit</th>
                  <th><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {disputes.map((errand) => {
                  const bySystem = errand.disputedBy === "system";
                  const isExpanded = expandedId === errand._id;
                  return (
                    <Fragment key={errand._id}>
                      <tr>
                        <td data-label="Errand">
                          <button
                            type="button"
                            className="dispute-expand-toggle"
                            aria-expanded={isExpanded}
                            aria-controls={`dispute-details-${errand._id}`}
                            onClick={() => setExpandedId((current) => (current === errand._id ? null : errand._id))}
                          >
                            <span className={`dispute-expand-caret ${isExpanded ? "open" : ""}`} aria-hidden="true">▸</span>
                            <span className="dispute-errand-id">{errand._id}</span>
                          </button>
                        </td>
                        <td data-label="Parties">
                          <small>Requester: {errand.requesterId}</small>
                          <small>Courier: {errand.courierId ?? "—"}</small>
                        </td>
                        <td data-label="Reason">
                          <span className={`dispute-source-tag ${bySystem ? "system" : "manual"}`}>
                            {bySystem ? "Deadline" : "Requester"}
                          </span>
                          <small>{errand.disputeReason ?? "—"}</small>
                        </td>
                        <td data-label="Disputed">
                          {errand.disputedAt ? timeAgo(errand.disputedAt, now) : "—"}
                        </td>
                        <td data-label="Credit">{formatCredits(errand.credit)}</td>
                        <td className="account-row-actions">
                          <button
                            type="button"
                            className="account-role-button promote"
                            disabled={resolving === errand._id}
                            onClick={() => void resolve(errand, "refund")}
                          >
                            {resolving === errand._id ? "Resolving…" : "Refund requester"}
                          </button>
                          <button
                            type="button"
                            className="account-role-button demote"
                            disabled={resolving === errand._id || !errand.courierId}
                            onClick={() => void resolve(errand, "transfer")}
                          >
                            {resolving === errand._id ? "Resolving…" : "Transfer to courier"}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="dispute-details-row">
                          <td colSpan={6} id={`dispute-details-${errand._id}`}>
                            <dl className="dispute-details">
                              <div><dt>Description</dt><dd>{errand.description}</dd></div>
                              <div><dt>Supplier</dt><dd>{errand.supplier.name}</dd></div>
                              <div><dt>Route</dt><dd>{errand.supplier.building} → {errand.dropoff}</dd></div>
                            </dl>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
