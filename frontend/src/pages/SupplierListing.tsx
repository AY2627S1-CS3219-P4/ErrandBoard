import { useEffect, useRef, useState } from "react";
import { IoFilterOutline } from "react-icons/io5";
import FilterModal from "../components/FilterModal";
import SupplierCard from "../components/SupplierCard";
import type { Supplier, SupplierFilters } from "../types/supplier";
import { apiFetch, supplierApiUrl } from "../api/client";
import "./Settings.css";
import "./SupplierListing.css";

export default function SupplierListing() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<SupplierFilters>({ categories: [], buildings: [] });
  const [buildings, setBuildings] = useState<string[]>([]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();

    apiFetch(supplierApiUrl("/suppliers"), {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : { suppliers: [] }))
      .then((data: { suppliers: Supplier[] }) => {
        const unique = new Set(data.suppliers.map((supplier) => supplier.building));
        setBuildings([...unique].sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {

      });

    return () => controller.abort();
  }, []);

  // Wait for the user to pause typing before querying the Supplier Service
  useEffect(() => {
    const timeout = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    // Aborting cancels stale requests so older results do not overwrite new ones
    const controller = new AbortController();

    async function loadSuppliers() {
      setIsLoading(true);
      setError("");

      try {
        const params = new URLSearchParams();
        if (search) params.set("search", search);
        filters.categories.forEach((category) => params.append("category", category));
        filters.buildings.forEach((building) => params.append("building", building));
        const query = params.size > 0 ? `?${params}` : "";

        const response = await apiFetch(supplierApiUrl(`/suppliers${query}`), {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Supplier Service responded ${response.status}`);
        }

        const data: { suppliers: Supplier[] } = await response.json();
        setSuppliers(data.suppliers);
      } catch {
        if (!controller.signal.aborted) {
          setError("Unable to reach the Supplier Service.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    loadSuppliers();

    return () => {
      controller.abort();
    };
  }, [search, filters]);

  const hasLoaded = !isLoading || suppliers.length > 0;
  const activeFilterCount = filters.categories.length + filters.buildings.length;

  function closeFilter() {
    setIsFilterOpen(false);
    filterButtonRef.current?.focus();
  }

  return (
    <main className="supplier-page">
      <header className="app-page-header supplier-page-header">
        <span />
        <h1>Suppliers</h1>
        <span />
      </header>

      <div className="supplier-search">
        <label htmlFor="supplier-search" className="visually-hidden">
          Search suppliers by name
        </label>
        <input
          id="supplier-search"
          type="search"
          placeholder="Search suppliers"
          autoComplete="off"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />
        <button
          ref={filterButtonRef}
          type="button"
          className="supplier-filter-button"
          aria-label="Filter suppliers"
          aria-haspopup="dialog"
          aria-expanded={isFilterOpen}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => (isFilterOpen ? closeFilter() : setIsFilterOpen(true))}
        >
          <IoFilterOutline aria-hidden="true" />
          {activeFilterCount > 0 && (
            <span className="supplier-filter-count">{activeFilterCount}</span>
          )}
        </button>

        {isFilterOpen && (
          <FilterModal
            buildings={buildings}
            initialFilters={filters}
            onApply={(nextFilters) => {
              setFilters(nextFilters);
              closeFilter();
            }}
            onClose={closeFilter}
          />
        )}
      </div>

      {!hasLoaded && <p>Loading suppliers...</p>}

      {error && <p role="alert">{error}</p>}

      {!isLoading && !error && suppliers.length === 0 && (
        <p>No suppliers found.</p>
      )}

      <ul className="supplier-list">
        {suppliers.map((supplier) => (
          <SupplierCard key={supplier._id} supplier={supplier} />
        ))}
      </ul>
    </main>
  );
}
