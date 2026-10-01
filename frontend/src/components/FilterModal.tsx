import { useEffect, useRef, useState } from "react";
import { CATEGORY_LABELS, type SupplierFilters } from "../types/supplier";
import "./FilterModal.css";

function toggleValue(values: string[], value: string) {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

export default function FilterModal({
  buildings,
  initialFilters,
  onApply,
  onClose,
}: {
  buildings: string[];
  initialFilters: SupplierFilters;
  onApply: (filters: SupplierFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initialFilters);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    function handlePointerDown(event: PointerEvent) {
      if (!modalRef.current?.contains(event.target as Node)) onClose();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [onClose]);

  return (
    <div
      ref={modalRef}
      className="supplier-filter-modal"
      role="dialog"
      aria-label="Filter suppliers"
    >
      <fieldset>
        <legend>Category</legend>
        {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
          <label key={value}>
            <input
              type="checkbox"
              checked={draft.categories.includes(value)}
              onChange={() =>
                setDraft({ ...draft, categories: toggleValue(draft.categories, value) })
              }
            />
            {label}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Building</legend>
        {buildings.length === 0 && <p>No buildings available.</p>}
        {buildings.map((building) => (
          <label key={building}>
            <input
              type="checkbox"
              checked={draft.buildings.includes(building)}
              onChange={() =>
                setDraft({ ...draft, buildings: toggleValue(draft.buildings, building) })
              }
            />
            {building}
          </label>
        ))}
      </fieldset>

      <button
        type="button"
        className="supplier-filter-reset"
        disabled={draft.categories.length === 0 && draft.buildings.length === 0}
        onClick={() => setDraft({ categories: [], buildings: [] })}
      >
        Reset
      </button>

      <button
        type="button"
        className="supplier-filter-apply"
        onClick={() => onApply(draft)}
      >
        Apply
      </button>
    </div>
  );
}
