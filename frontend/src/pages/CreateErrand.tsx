import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiFetch, supplierApiUrl } from "../api/client";
import { createErrand, describeError, ErrandApiError } from "../api/errands";
import "../components/errand-buttons.css";
import "../components/SupplierCard.css";
import { CATEGORY_LABELS, type Supplier } from "../types/supplier";
import "./CreateErrand.css";

// Mirrors the order-service schema: dropoff <= 100, description <= 500, credit integer >= 1.
const DROPOFF_MAX = 100;
const NOTES_MAX = 500;

type FieldErrors = Partial<Record<"credit" | "dropoff" | "description", string>>;

function validate(credit: string, dropoff: string, notes: string): FieldErrors {
  const errors: FieldErrors = {};
  const amount = Number(credit);
  if (!credit.trim() || !Number.isInteger(amount) || amount < 1) errors.credit = "Enter a whole number of credits, at least 1.";
  if (!dropoff.trim()) errors.dropoff = "Enter where the item should be delivered.";
  if (!notes.trim()) errors.description = "Add a note for the courier (what to buy, any details).";
  return errors;
}

/** Errand creation page (F26.2). The errand is only created when Confirm is pressed. */
export default function CreateErrand() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [loadError, setLoadError] = useState("");
  const [credit, setCredit] = useState("");
  const [dropoff, setDropoff] = useState("");
  const [notes, setNotes] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    apiFetch(supplierApiUrl(`/suppliers/${encodeURIComponent(id)}`), { signal: controller.signal })
      .then(async (response) => {
        if (response.status === 404) throw new Error("This supplier no longer exists.");
        if (!response.ok) throw new Error("Unable to load the supplier.");
        const data: { supplier: Supplier } = await response.json();
        setSupplier(data.supplier);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : "Unable to reach the server.");
      });
    return () => controller.abort();
  }, [id]);

  async function handleConfirm() {
    if (!supplier || isSubmitting) return; // guards against double-click creating two errands
    const errors = validate(credit, dropoff, notes);
    setFieldErrors(errors);
    setSubmitError("");
    if (Object.keys(errors).length > 0) return;

    setIsSubmitting(true);
    try {
      await createErrand({
        supplierId: supplier._id,
        dropoff: dropoff.trim(),
        description: notes.trim(),
        credit: Number(credit),
      });
      navigate("/errands/active");
    } catch (cause) {
      if (cause instanceof ErrandApiError && Object.keys(cause.fields).length > 0) {
        // Field-level detail from the server (same shape as the supplier service, F6.3.1)
        setFieldErrors({
          credit: cause.fields.credit,
          dropoff: cause.fields.dropoff,
          description: cause.fields.description,
        });
      }
      setSubmitError(describeError(cause));
      setIsSubmitting(false);
    }
  }

  return (
    <main className="create-errand-page">
      <Link className="create-errand-back" to={id ? `/supplier/${id}` : "/suppliers"}>← Back to supplier</Link>
      <h1 className="create-errand-title">Request an errand</h1>

      {loadError && <p role="alert" className="create-errand-error">{loadError}</p>}
      {!supplier && !loadError && <p>Loading supplier…</p>}

      {supplier && (
        <>
          {/* Non-interactable supplier card (F26.2.1) */}
          <div className="supplier-card create-errand-supplier" aria-label="Pickup supplier">
            <div className="supplier-card-image">
              {supplier.imageUrl ? <img src={supplier.imageUrl} alt="" /> : <span aria-hidden="true">{supplier.name.charAt(0)}</span>}
            </div>
            <div className="supplier-card-details">
              <h2 className="supplier-card-name">{supplier.name}</h2>
              <p className="supplier-card-meta">{CATEGORY_LABELS[supplier.category] ?? supplier.category} • {supplier.building}</p>
            </div>
          </div>

          <form className="create-errand-form" onSubmit={(event) => event.preventDefault()} noValidate>
            <label htmlFor="errand-credit">Reward (credits)</label>
            <input
              id="errand-credit"
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={credit}
              aria-invalid={Boolean(fieldErrors.credit)}
              onChange={(event) => setCredit(event.target.value)}
            />
            {fieldErrors.credit && <p className="create-errand-error" role="alert">{fieldErrors.credit}</p>}

            <label htmlFor="errand-dropoff-input">Destination</label>
            <input
              id="errand-dropoff-input"
              type="text"
              maxLength={DROPOFF_MAX}
              placeholder="e.g. COM1 level 2 lobby"
              value={dropoff}
              aria-invalid={Boolean(fieldErrors.dropoff)}
              onChange={(event) => setDropoff(event.target.value)}
            />
            {fieldErrors.dropoff && <p className="create-errand-error" role="alert">{fieldErrors.dropoff}</p>}

            <label htmlFor="errand-notes">Notes to courier</label>
            <textarea
              id="errand-notes"
              rows={4}
              maxLength={NOTES_MAX}
              placeholder="What should the courier get? Any special instructions?"
              value={notes}
              aria-invalid={Boolean(fieldErrors.description)}
              onChange={(event) => setNotes(event.target.value)}
            />
            <p className="create-errand-count">{notes.length}/{NOTES_MAX}</p>
            {fieldErrors.description && <p className="create-errand-error" role="alert">{fieldErrors.description}</p>}

            {submitError && <p className="create-errand-error" role="alert">{submitError}</p>}

            <div className="create-errand-actions">
              <button type="button" className="errand-btn" onClick={() => navigate(-1)} disabled={isSubmitting}>Cancel</button>
              <button type="button" className="errand-btn errand-btn-primary" onClick={handleConfirm} disabled={isSubmitting}>
                {isSubmitting ? "Creating…" : "Confirm"}
              </button>
            </div>
          </form>
        </>
      )}
    </main>
  );
}
