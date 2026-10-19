import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { describeError, ErrandApiError, listMyErrands, runErrandAction } from "../api/errands";
import { useAuth } from "../auth/useAuth";
import ActiveErrandCard from "../components/ActiveErrandCard";
import ErrandPreviewModal from "../components/ErrandPreviewModal";
import { useNow } from "../hooks/useNow";
import { ACTIVE_STATUSES_SET, type Errand, type ErrandAction } from "../types/errand";
import "./Errands.css";

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
  const [error, setError] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);
  const [busy, setBusy] = useState<{ id: string; action: ErrandAction } | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => setRefreshTick((tick) => tick + 1), REFRESH_MS);
    return () => clearInterval(id);
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

  const handleAction = useCallback(async (errand: Errand, action: ErrandAction) => {
    const prompt = CONFIRMATIONS[action];
    if (prompt && !window.confirm(prompt)) return;

    setBusy({ id: errand._id, action });
    setError("");
    try {
      const updated = await runErrandAction(errand._id, action);
      // Terminal errands leave the active list everything else is updated in place.
      setErrands((current) =>
        ACTIVE_STATUSES_SET.has(updated.status)
          ? current.map((item) => (item._id === updated._id ? updated : item))
          : current.filter((item) => item._id !== updated._id),
      );
    } catch (cause) {
      setError(describeError(cause));
      if (cause instanceof ErrandApiError && cause.status === 409) setRefreshTick((tick) => tick + 1);
    } finally {
      setBusy(null);
    }
  }, []);

  const requested = errands.filter((errand) => errand.requesterId === user?.id);
  const accepted = errands.filter((errand) => errand.courierId === user?.id);
  const preview = errands.find((errand) => errand._id === previewId) ?? null;

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
    </main>
  );
}
