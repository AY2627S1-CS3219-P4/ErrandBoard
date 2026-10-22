import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch, supplierApiUrl } from "../api/client";
import { acceptErrand, describeError, ErrandApiError, listOpenErrands } from "../api/errands";
import { useAuth } from "../auth/useAuth";
import ErrandCard from "../components/ErrandCard";
import ErrandPreviewModal from "../components/ErrandPreviewModal";
import { useNow } from "../hooks/useNow";
import type { Errand } from "../types/errand";
import type { Supplier } from "../types/supplier";
import "./Errands.css";

const SINCE_OPTIONS = [
  { key: "any", label: "Any time", ms: 0 },
  { key: "1h", label: "Last hour", ms: 60 * 60 * 1000 },
  { key: "24h", label: "Last 24 hours", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "Last 7 days", ms: 7 * 24 * 60 * 60 * 1000 },
] as const;

const REFRESH_MS = 30_000;

// Accept failures where this errand can never be taken by the user: drop it from the board and stop retries.
const UNAVAILABLE_CODES = ["UPDATE_CONFLICT", "ERRAND_NOT_FOUND", "DEADLINE_PASSED"];
const BLOCKING_CODES = [...UNAVAILABLE_CODES, "SELF_ASSIGN"];

/** Open errand board (F9): search, filter, preview and accept. */
export default function ErrandListing() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const now = useNow();

  const [errands, setErrands] = useState<Errand[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState("");

  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [dropoffInput, setDropoffInput] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [building, setBuilding] = useState("");
  const [sinceKey, setSinceKey] = useState<(typeof SINCE_OPTIONS)[number]["key"]>("any");
  const [buildings, setBuildings] = useState<string[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  const [selected, setSelected] = useState<Errand | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState("");
  const [acceptBlocked, setAcceptBlocked] = useState(false); // errand is gone/taken/yours: no point retrying

  // Pickup-location options come from the supplier service.
  useEffect(() => {
    const controller = new AbortController();
    apiFetch(supplierApiUrl("/suppliers"), { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : { suppliers: [] }))
      .then((data: { suppliers: Supplier[] }) => {
        setBuildings([...new Set(data.suppliers.map((s) => s.building))].sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  // Debounce typing so each keystroke doesn't hit the order service (F7.2.3-style live search).
  useEffect(() => {
    const timeout = setTimeout(() => setQ(searchInput.trim()), 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);
  useEffect(() => {
    const timeout = setTimeout(() => setDropoff(dropoffInput.trim()), 300);
    return () => clearTimeout(timeout);
  }, [dropoffInput]);

  // Keep the board fresh: expired and taken errands drop out without a manual reload.
  useEffect(() => {
    const id = setInterval(() => setRefreshTick((tick) => tick + 1), REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const windowMs = SINCE_OPTIONS.find((option) => option.key === sinceKey)?.ms ?? 0;

    listOpenErrands(
      {
        q: q || undefined,
        dropoff: dropoff || undefined,
        building: building ? [building] : undefined,
        since: windowMs ? new Date(Date.now() - windowMs).toISOString() : undefined,
      },
      controller.signal,
    )
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
  }, [q, dropoff, building, sinceKey, refreshTick]);

  const openPreview = useCallback((errand: Errand) => {
    setSelected(errand);
    setAcceptError("");
    setAcceptBlocked(false);
  }, []);

  const closePreview = useCallback(() => {
    setSelected(null);
    setAcceptError("");
    setAcceptBlocked(false);
  }, []);

  async function handleAccept() {
    if (!selected || isAccepting || acceptBlocked) return;
    setIsAccepting(true);
    setAcceptError("");
    try {
      await acceptErrand(selected._id);
      navigate("/errands/active");
    } catch (cause) {
      setAcceptError(describeError(cause));
      if (cause instanceof ErrandApiError && BLOCKING_CODES.includes(cause.code)) {
        setAcceptBlocked(true); // the errand can't be taken by this user, so stop further Accept attempts
        if (UNAVAILABLE_CODES.includes(cause.code)) setRefreshTick((tick) => tick + 1); // and drop it from the board
      }
    } finally {
      setIsAccepting(false);
    }
  }

  return (
    <main className="errands-page">
      <header className="app-page-header">
        <span />
        <h1>Errands</h1>
        <span />
      </header>

      <nav className="errands-tabs" aria-label="Errand views">
        <Link className="errands-tab errands-tab-active" to="/errands" aria-current="page">Open errands</Link>
        <Link className="errands-tab" to="/errands/active">My errands</Link>
      </nav>

      <div className="errands-filters">
        <label className="visually-hidden" htmlFor="errand-search">Search errand notes</label>
        <input
          id="errand-search"
          type="search"
          placeholder="Search notes (e.g. chicken rice)"
          autoComplete="off"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />
        <label className="visually-hidden" htmlFor="errand-building">Pickup location</label>
        <select id="errand-building" value={building} onChange={(event) => setBuilding(event.target.value)}>
          <option value="">Any pickup location</option>
          {buildings.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <label className="visually-hidden" htmlFor="errand-dropoff">Drop-off location</label>
        <input
          id="errand-dropoff"
          type="text"
          placeholder="Drop-off location"
          autoComplete="off"
          value={dropoffInput}
          onChange={(event) => setDropoffInput(event.target.value)}
        />
        <label className="visually-hidden" htmlFor="errand-since">Posted</label>
        <select id="errand-since" value={sinceKey} onChange={(event) => setSinceKey(event.target.value as typeof sinceKey)}>
          {SINCE_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
      </div>

      {!hasLoaded && <p className="errands-status">Loading errands…</p>}
      {error && <p className="errands-error" role="alert">{error}</p>}
      {hasLoaded && !error && errands.length === 0 && (
        <p className="errands-status">No open errands match your filters.</p>
      )}

      <ul className="errands-list">
        {errands.map((errand) => (
          <ErrandCard
            key={errand._id}
            errand={errand}
            now={now}
            isOwn={errand.requesterId === user?.id}
            onSelect={openPreview}
          />
        ))}
      </ul>

      {selected && (
        <ErrandPreviewModal
          errand={selected}
          now={now}
          isOwn={selected.requesterId === user?.id}
          isBusy={isAccepting}
          acceptBlocked={acceptBlocked}
          error={acceptError}
          onAccept={handleAccept}
          onClose={closePreview}
        />
      )}
    </main>
  );
}
