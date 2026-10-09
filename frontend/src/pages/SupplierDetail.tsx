import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CATEGORY_LABELS, type OpeningHours, type Supplier } from "../types/supplier";
import { apiFetch, supplierApiUrl } from "../api/client";
import "./SupplierDetail.css";

const DAYS: { key: keyof OpeningHours; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

export default function SupplierDetail() {
  const { id } = useParams<{ id: string }>();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();

    async function loadSupplier() {
      setIsLoading(true);
      setError("");

      try {
        const response = await apiFetch(supplierApiUrl(`/suppliers/${encodeURIComponent(id!)}`), {
          signal: controller.signal,
        });

        if (response.status === 404) {
          setError("Supplier not found.");
          return;
        }

        if (!response.ok) {
          throw new Error(`Server responded ${response.status}`);
        }

        const data: { supplier: Supplier } = await response.json();
        setSupplier(data.supplier);
      } catch {
        if (!controller.signal.aborted) {
          setError("Unable to reach the server.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    loadSupplier();

    return () => {
      controller.abort();
    };
  }, [id]);

  return (
    <main className="supplier-detail-page">
      <Link className="supplier-detail-back" to="/suppliers">
        ← Back to suppliers
      </Link>

      {isLoading && <p>Loading supplier...</p>}

      {error && <p role="alert">{error}</p>}

      {!isLoading && !error && supplier && (
        <article className="supplier-detail">
          <div className="supplier-detail-image">
            {supplier.imageUrl ? (
              <img src={supplier.imageUrl} alt="" />
            ) : (
              <span aria-hidden="true">{supplier.name.charAt(0)}</span>
            )}
          </div>
          <header className="supplier-detail-header">
            <h1 className="supplier-detail-name">{supplier.name}</h1>
            <p className="supplier-detail-meta">
              {CATEGORY_LABELS[supplier.category] ?? supplier.category} • {supplier.building}
              {supplier.locationDescription && ` (${supplier.locationDescription})`}
            </p>
          </header>

          <section className="supplier-detail-section">
            <h2>Address</h2>
            <p>{supplier.address}</p>
          </section>

          <section className="supplier-detail-section">
            <h2>Description</h2>
            {supplier.description ? <p>{supplier.description}</p> : <p>NA</p>}
          </section>

          <details className="supplier-detail-section supplier-detail-hours">
            <summary>
              <h2>Opening Hours</h2>
            </summary>
            {supplier.openingHours ? (
              <dl className="supplier-detail-hours-list">
                {DAYS.map(({ key, label }) => {
                  const slots = supplier.openingHours![key];
                  return (
                    <div key={key} className="supplier-detail-hours-row">
                      <dt>{label}</dt>
                      <dd>
                        {slots.length === 0
                          ? "Closed"
                          : slots.map((slot) => `${slot.open} – ${slot.close}`).join(", ")}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            ) : (
              <p>NA</p>
            )}
          </details>
          
          <button type="button" className="supplier-detail-errand-button">
            Open Errand
          </button>
        </article>
      )}
    </main>
  );
}
