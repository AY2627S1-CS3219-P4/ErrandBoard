import { useEffect, useState } from "react";

const SUPPLIER_API_URL =
  import.meta.env.VITE_SUPPLIER_API_BASE_URL ?? "http://localhost:3002";

interface Supplier {
  _id: string;
  name: string;
  category: string;
  building: string;
  description?: string;
}

export default function SupplierListing() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadSuppliers() {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch(`${SUPPLIER_API_URL}/suppliers`, {
          credentials: "include",
        });

        if (!response.ok) {
          throw new Error(`Supplier Service responded ${response.status}`);
        }

        const data: { suppliers: Supplier[] } = await response.json();

        if (!cancelled) {
          setSuppliers(data.suppliers);
        }
      } catch {
        if (!cancelled) {
          setError("Unable to reach the Supplier Service.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadSuppliers();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main>
      <h1>Suppliers</h1>

      {isLoading && <p>Loading suppliers...</p>}

      {error && <p role="alert">{error}</p>}

      {!isLoading && !error && suppliers.length === 0 && (
        <p>No suppliers found.</p>
      )}

      <ul>
        {suppliers.map((supplier) => (
          <li key={supplier._id}>
            <strong>{supplier.name}</strong> — {supplier.category} (
            {supplier.building})
            {supplier.description && <p>{supplier.description}</p>}
          </li>
        ))}
      </ul>
    </main>
  );
}
