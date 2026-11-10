import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { describeError, ErrandApiError, listMyErrands, runErrandAction, disputeErrand} from "../api/errands";
import { useAuth } from "../auth/useAuth";
import ActiveErrandCard from "../components/ActiveErrandCard";
import ErrandPreviewModal from "../components/ErrandPreviewModal";
import DisputeModal from "../components/DisputeModal";
import { useNow } from "../hooks/useNow";
import { NOTIFICATION_RECEIVED_EVENT } from "../notifications/types";
import { ACTIVE_STATUSES_SET, type Errand, type ErrandAction } from "../types/errand";
import "./Errands.css"

const REFRESH_MS = 15_000;

const CONFIRMATIONS: Partial<Record<ErrandAction, string>> = {
  cancel: "Cancel this errand? Your reserved credits will be released.",
  "courier-cancel": "Cancel this errand? It will be closed and the requester's credits released.",
  complete: "Confirm you received your item? Credits will be paid to the courier and this cannot be undone.",
};

// Active errands for the signed-in user, as requester and as courier
export default function ActiveErrands() {
  const { user } = useAuth();
  const now = useNow(15_000);

  const [errands, setErrands] = useState<Errand[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState(""); // list-load failures (page-level)
  const [actionError, setActionError] = useState<{ id: string; message: string } | null>(null); // per-card
  const [refreshTick, setRefreshTick] = useState(0);
  const [busy, setBusy] = useState<{ id: string; action: ErrandAction } | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [disputeId, setDisputeId] = useState<string | null>(null); // errand whose dispute modal is open

  useEffect(() => {
    const id = setInterval(() => setRefreshTick((tick) => tick + 1), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  // A status notification arrived (live stream or service worker): reload now instead of waiting for the next poll.
  useEffect(() => {
    const reload = () => setRefreshTick((tick) => tick + 1);
    window.addEventListener(NOTIFICATION_RECEIVED_EVENT, reload);
    return () => window.removeEventListener(NOTIFICATION_RECEIVED_EVENT, reload);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    listMyErrands(controller.signal)
      .then((result) => {
        setErrands(result);
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

  // Runs one errand mutation and reconciles the list. `apply` performs the request.
  const runMutation = useCallback(async (errand: Errand, action: ErrandAction, apply: () => Promise<Errand>) => {
    setBusy({ id: errand._id, action });
    setActionError(null);
    try {
      const updated = await apply();
      // Terminal errands leave the active list; active and disputed (held) errands stay in place.
      setErrands((current) =>
        ACTIVE_STATUSES_SET.has(updated.status) || updated.status === "DISPUTED"
          ? current.map((item) => (item._id === updated._id ? updated : item))
          : current.filter((item) => item._id !== updated._id),
      );
      return true;
    } catch (cause) {
      setActionError({ id: errand._id, message: describeError(cause) }); // show next to the card that failed
      // 409 (conflict/deadline) or 404 (already gone) mean our copy is stale, so reload from the server.
      if (cause instanceof ErrandApiError && (cause.status === 409 || cause.status === 404)) {
        setRefreshTick((tick) => tick + 1);
      }
      return false;
    } finally {
      setBusy(null);
    }
  }, []);

  // The "Review & confirm" button on a delivered-notification opens /errands/active?review=<errandId>.
  // Offer the same Confirm action as the card (including its "cannot be undone" prompt) instead of
  // paying out from the notification itself. Derived while rendering: it disappears once the errand moves on.
  const [searchParams, setSearchParams] = useSearchParams();
  const reviewId = searchParams.get("review");
  const reviewErrand = reviewId
    ? errands.find((item) => item._id === reviewId && item.requesterId === user?.id && item.status === "PENDING_COMPLETION")
    : undefined;
  const handleAction = useCallback((errand: Errand, action: ErrandAction) => {
    // disputing opens a modal to collect a reason; other actions just confirm.
    if (action === "dispute") {
      setActionError(null);
      setDisputeId(errand._id);
      return;
    }
    const prompt = CONFIRMATIONS[action];
    if (prompt && !window.confirm(prompt)) return;
    void runMutation(errand, action, () => runErrandAction(errand._id, action));
  }, [runMutation]);

  const submitDispute = useCallback(async (errand: Errand, reason: string) => {
    const ok = await runMutation(errand, "dispute", () => disputeErrand(errand._id, reason));
    if (ok) setDisputeId(null); // keep the modal open on failure so the error shows in context
  }, [runMutation]);

  const requested = errands.filter((errand) => errand.requesterId === user?.id);
  const accepted = errands.filter((errand) => errand.courierId === user?.id);
  const preview = errands.find((errand) => errand._id === previewId) ?? null;
  const disputeTarget = errands.find((errand) => errand._id === disputeId) ?? null;

  function renderCards(list: Errand[], role: "requester" | "courier") {
    return (
      <ul className="errands-list">
        {list.map((errand) => (
          <ActiveErrandCard
            key={errand._id}
            errand={errand}
            role={role}
            now={now}
            busyAction={busy?.id === errand._id ? busy.action : null}
            error={actionError?.id === errand._id ? actionError.message : ""}
            onAction={(action) => handleAction(errand, action)}
            onOpen={() => setPreviewId(errand._id)}
          />
        ))}
      </ul>
    );
  }

  return (
    <main className="errands-page">
      <header className="app-page-header">
        <span />
        <h1>My errands</h1>
        <span />
      </header>

      <nav className="errands-tabs" aria-label="Errand views">
        <Link className="errands-tab" to="/errands">Open errands</Link>
        <Link className="errands-tab errands-tab-active" to="/errands/active" aria-current="page">My errands</Link>
      </nav>

      {reviewErrand && (
        <section className="errands-review" role="alert" aria-label="Confirm receipt">
          <p>
            Your courier marked your <strong>{reviewErrand.supplier.name}</strong> errand as delivered.
            Did you receive your item?
          </p>
          <div className="errands-review-actions">
            <button className="errands-review-confirm" type="button"
              disabled={busy !== null} onClick={() => void handleAction(reviewErrand, "complete")}>
              Confirm receipt
            </button>
            <button className="errands-review-dismiss" type="button" onClick={() => setSearchParams({}, { replace: true })}>
              Not yet
            </button>
          </div>
        </section>
      )}

      {!hasLoaded && <p className="errands-status">Loading your errands…</p>}
      {error && <p className="errands-error" role="alert">{error}</p>}
      {hasLoaded && !error && errands.length === 0 && (
        <p className="errands-status">
          You have no active errands. Pick a supplier to <Link to="/suppliers">request one</Link>, or{" "}
          <Link to="/errands">accept one</Link> from the board.
        </p>
      )}

      {requested.length > 0 && (
        <section>
          <h2 className="errands-section-title">Requested by me</h2>
          {renderCards(requested, "requester")}
        </section>
      )}
      {accepted.length > 0 && (
        <section>
          <h2 className="errands-section-title">Accepted by me</h2>
          {renderCards(accepted, "courier")}
        </section>
      )}

      {preview && (
        <ErrandPreviewModal
          errand={preview}
          now={now}
          isOwn={preview.requesterId === user?.id}
          onClose={() => setPreviewId(null)}
        />
      )}

      {disputeTarget && (
        <DisputeModal
          errand={disputeTarget}
          isBusy={busy?.id === disputeTarget._id && busy.action === "dispute"}
          error={actionError?.id === disputeTarget._id ? actionError.message : ""}
          onSubmit={(reason) => void submitDispute(disputeTarget, reason)}
          onClose={() => setDisputeId(null)}
        />
      )}
    </main>
  );
}
