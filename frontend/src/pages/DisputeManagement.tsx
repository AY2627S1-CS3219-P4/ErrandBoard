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
import { getErrandStats, type ErrandStats } from "../api/adminStats";
import { StatCard, StatGrid } from "../components/StatCard";
import ConfirmModal from "../components/ConfirmModal";
import type { Errand } from "../types/errand";
import { useNow } from "../hooks/useNow";
import "./AdminDashboard.css";
import "./AccountAdministration.css";
import "./DisputeManagement.css";

type Outcome = "refund" | "transfer";
type SortKey = "disputed" | "credit";
type SortDir = "asc" | "desc";

function statValue(loading: boolean, value: number | undefined): string {
  if (loading) return "…";
  return typeof value === "number" ? value.toLocaleString() : "—";
}

// Sort the disputes in place by the chosen column and direction.
function sortDisputes(disputes: Errand[], key: SortKey, dir: SortDir): Errand[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...disputes].sort((a, b) => {
    const diff = key === "credit"
      ? a.credit - b.credit
      : new Date(a.disputedAt ?? 0).getTime() - new Date(b.disputedAt ?? 0).getTime();
    return diff * factor;
  });
}

export default function DisputeManagement() {
  const { user } = useAuth();
  const now = useNow();
  const [disputes, setDisputes] = useState<Errand[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null); // row whose details are open
  const [stats, setStats] = useState<ErrandStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  // default: oldest dispute first, matching the server's disputedAt-ascending order
  const [sortKey, setSortKey] = useState<SortKey>("disputed");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [pendingResolve, setPendingResolve] = useState<{ errand: Errand; outcome: Outcome } | null>(null);
  const [resolvedNotice, setResolvedNotice] = useState<string | null>(null);

  // Clicking a column sorts by it; clicking the active column flips the direction.
  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sortedDisputes = sortDisputes(disputes, sortKey, sortDir);

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

  useEffect(() => {
    const controller = new AbortController();
    // `statsLoading` starts true; on a refresh the prior stats stay shown until the fetch settles.
    getErrandStats(controller.signal)
      .then((result) => setStats(result))
      .catch(() => { if (!controller.signal.aborted) setStats(null); })
      .finally(() => { if (!controller.signal.aborted) setStatsLoading(false); });
    return () => controller.abort();
  }, [refreshTick]);

  // runs the resolution once the admin confirms it in the modal
  async function doResolve(errand: Errand, outcome: Outcome) {
    setResolving(errand._id);
    setError("");
    try {
      await (outcome === "refund" ? resolveDisputeRefund(errand._id) : resolveDisputeTransfer(errand._id));
      setDisputes((current) => current.filter((item) => item._id !== errand._id));
      setResolvedNotice(
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
      setPendingResolve(null);
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

      <StatGrid variant="auto" aria-label="Errand statistics">
        <StatCard icon="TOTAL" label="Total errands" value={statValue(statsLoading, stats?.total)} caption="All time" />
        <StatCard icon="ACTIVE" label="Active" value={statValue(statsLoading, stats?.active)} caption="In progress" />
        <StatCard icon="OPEN" label="Open" value={statValue(statsLoading, stats?.openActive)} caption="Awaiting a courier" />
        <StatCard icon="DONE" label="Completed" value={statValue(statsLoading, stats?.completed)} caption="Delivered" />
        <StatCard icon="CXL" label="Cancelled" value={statValue(statsLoading, stats?.cancelled)} caption="Called off" />
        <StatCard icon="EXP" label="Expired" value={statValue(statsLoading, stats?.expired)} caption="Timed out" />
        <StatCard icon="DISP" label="Disputed" value={statValue(statsLoading, stats?.disputed)} caption="Awaiting review" />
        <StatCard icon="SYS" label="Auto-raised" value={statValue(statsLoading, stats?.disputedBySystem)} caption="By deadline sweep" />
        <StatCard icon="HELD" label="Credits held" value={statValue(statsLoading, stats?.creditsHeld)} caption="Locked in disputes" />
      </StatGrid>

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
          <>
          {/* Mobile sort control: the table header (and its sort buttons) is hidden on narrow screens. */}
          <div className="dispute-sort-bar" role="group" aria-label="Sort disputes">
            <span>Sort by</span>
            {(["disputed", "credit"] as SortKey[]).map((key) => (
              <button
                key={key}
                type="button"
                className={`dispute-sort-chip ${sortKey === key ? "active" : ""}`}
                aria-pressed={sortKey === key}
                onClick={() => toggleSort(key)}
              >
                {key === "disputed" ? "Time" : "Credit"}
                {sortKey === key && <span aria-hidden="true"> {sortDir === "asc" ? "▲" : "▼"}</span>}
              </button>
            ))}
          </div>
          <div className="account-table-wrap">
            <table className="account-table dispute-table">
              <thead>
                <tr>
                  <th>Errand</th>
                  <th>Parties</th>
                  <th>Reason</th>
                  <th aria-sort={sortKey === "disputed" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" className="dispute-sort-btn" onClick={() => toggleSort("disputed")}>
                      Disputed
                      <span className="dispute-sort-caret" aria-hidden="true">
                        {sortKey === "disputed" ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
                      </span>
                    </button>
                  </th>
                  <th aria-sort={sortKey === "credit" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
                    <button type="button" className="dispute-sort-btn" onClick={() => toggleSort("credit")}>
                      Credit
                      <span className="dispute-sort-caret" aria-hidden="true">
                        {sortKey === "credit" ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
                      </span>
                    </button>
                  </th>
                  <th><span className="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {sortedDisputes.map((errand) => {
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
                            onClick={() => setPendingResolve({ errand, outcome: "refund" })}
                          >
                            {resolving === errand._id ? "Resolving…" : "Refund requester"}
                          </button>
                          <button
                            type="button"
                            className="account-role-button demote"
                            disabled={resolving === errand._id || !errand.courierId}
                            onClick={() => setPendingResolve({ errand, outcome: "transfer" })}
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
          </>
        )}
      </section>

      {pendingResolve && (
        <ConfirmModal
          title={pendingResolve.outcome === "refund" ? "Refund the requester?" : "Transfer to the courier?"}
          message={
            pendingResolve.outcome === "refund"
              ? `${formatCredits(pendingResolve.errand.credit)} will be returned to the requester. This cannot be undone.`
              : `${formatCredits(pendingResolve.errand.credit)} will be paid to the courier. This cannot be undone.`
          }
          confirmLabel={pendingResolve.outcome === "refund" ? "Refund requester" : "Transfer to courier"}
          busy={resolving === pendingResolve.errand._id}
          onConfirm={() => void doResolve(pendingResolve.errand, pendingResolve.outcome)}
          onClose={() => setPendingResolve(null)}
        />
      )}

      {resolvedNotice && (
        <ConfirmModal
          eyebrow="DISPUTE RESOLVED"
          title="Dispute resolved"
          message={resolvedNotice}
          variant="acknowledge"
          confirmLabel="Done"
          onClose={() => setResolvedNotice(null)}
        />
      )}
    </main>
  );
}
