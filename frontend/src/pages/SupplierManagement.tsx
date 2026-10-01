import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { CATEGORY_LABELS, type Supplier } from "../types/supplier";
import "./SupplierManagement.css";

const SUPPLIER_API_URL = (import.meta.env.VITE_SUPPLIER_API_BASE_URL ?? "http://localhost:3002").replace(/\/$/, "");
const CATEGORIES = Object.keys(CATEGORY_LABELS);

function supplierApiUrl(path: string): string {
  return `${SUPPLIER_API_URL}${path}`;
}

function supplierFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(supplierApiUrl(path), {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...init.headers,
    },
  });
}

type SupplierForm = {
  name: string;
  category: string;
  building: string;
  address: string;
  description: string;
  imageUrl: string;
};

type StatusChange = {
  supplier: Supplier;
  action: "deactivate" | "reactivate";
};

const EMPTY_FORM: SupplierForm = {
  name: "",
  category: CATEGORIES[0],
  building: "",
  address: "",
  description: "",
  imageUrl: "",
};

function formFromSupplier(supplier: Supplier): SupplierForm {
  return {
    name: supplier.name,
    category: supplier.category,
    building: supplier.building,
    address: supplier.address,
    description: supplier.description ?? "",
    imageUrl: supplier.imageUrl ?? "",
  };
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    if (body.error) return body.error;
  } catch {
    // Fall through to a status-based message.
  }
  return `Supplier Service responded with HTTP ${response.status}.`;
}

export default function SupplierManagement() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState<SupplierForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusChange, setStatusChange] = useState<StatusChange | null>(null);

  const loadSuppliers = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ showInactive: String(showInactive) });
      if (search.trim()) params.set("search", search.trim());
      const response = await supplierFetch(`/suppliers?${params}`);
      if (!response.ok) throw new Error(await responseError(response));
      const body = await response.json() as { suppliers: Supplier[] };
      setSuppliers(body.suppliers);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to load suppliers.");
    } finally {
      setIsLoading(false);
    }
  }, [search, showInactive]);

  useEffect(() => {
    void loadSuppliers();
  }, [loadSuppliers]);

  const activeCount = useMemo(() => suppliers.filter((supplier) => supplier.isActive).length, [suppliers]);

  function updateForm(field: keyof SupplierForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function startEditing(supplier: Supplier) {
    setEditingId(supplier._id);
    setForm(formFromSupplier(supplier));
    setNotice("");
    setError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEditing() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function saveSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    setNotice("");

    const payload = {
      name: form.name.trim(),
      category: form.category,
      building: form.building.trim(),
      address: form.address.trim(),
      description: form.description.trim() || undefined,
      imageUrl: form.imageUrl.trim() || undefined,
    };

    try {
      const response = await supplierFetch(
        `/suppliers${editingId ? `/${editingId}` : ""}`,
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!response.ok) throw new Error(await responseError(response));
      setNotice(editingId ? "Supplier updated successfully." : "Supplier created successfully.");
      cancelEditing();
      await loadSuppliers();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to save supplier.");
    } finally {
      setIsSaving(false);
    }
  }

  function requestStatusChange(supplier: Supplier, action: StatusChange["action"]) {
    setStatusChange({ supplier, action });
  }

  async function confirmStatusChange() {
    if (!statusChange) return;

    const { supplier, action } = statusChange;
    setDeletingId(supplier._id);
    setError("");
    setNotice("");
    try {
      const response = action === "deactivate"
        ? await supplierFetch(`/suppliers/${supplier._id}`, { method: "DELETE" })
        : await supplierFetch(`/suppliers/${supplier._id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isActive: true }),
          });
      if (!response.ok) throw new Error(await responseError(response));
      setNotice(`${supplier.name} was ${action === "deactivate" ? "deactivated" : "reactivated"}.`);
      await loadSuppliers();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `Unable to ${action} supplier.`);
    } finally {
      setDeletingId(null);
      setStatusChange(null);
    }
  }

  return (
    <main className="supplier-management-page">
      <Link className="admin-back-button" to="/admin">
        <span aria-hidden="true">←</span>
        Back to dashboard
      </Link>

      <header className="supplier-management-heading">
        <div>
          <p className="eyebrow">ADMINISTRATION / PLATFORM</p>
          <h1>Supplier Management</h1>
          <p>Create, update, and deactivate the suppliers shown to requesters and couriers.</p>
        </div>
        <div className="supplier-count-badge" aria-label={`${activeCount} active suppliers`}>
          <strong>{activeCount}</strong>
          <span>active suppliers</span>
        </div>
      </header>

      <section className="supplier-management-panel" aria-labelledby="supplier-form-title">
        <div className="supplier-panel-heading">
          <div>
            <p className="eyebrow">{editingId ? "EDIT SUPPLIER" : "NEW SUPPLIER"}</p>
            <h2 id="supplier-form-title">{editingId ? "Update supplier details" : "Add a supplier"}</h2>
          </div>
          {editingId && <button className="supplier-secondary-button" type="button" onClick={cancelEditing}>Cancel edit</button>}
        </div>

        <form className="supplier-form" onSubmit={saveSupplier}>
          <label>Supplier name<input required maxLength={100} value={form.name} onChange={(event) => updateForm("name", event.target.value)} /></label>
          <label>Category<select value={form.category} onChange={(event) => updateForm("category", event.target.value)}>{CATEGORIES.map((category) => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}</select></label>
          <label>Building<input required maxLength={100} value={form.building} onChange={(event) => updateForm("building", event.target.value)} /></label>
          <label>Address<input required maxLength={100} value={form.address} onChange={(event) => updateForm("address", event.target.value)} /></label>
          <label className="supplier-form-wide">Description<textarea maxLength={500} rows={3} value={form.description} onChange={(event) => updateForm("description", event.target.value)} /></label>
          <label className="supplier-form-wide">Image URL<input type="url" value={form.imageUrl} onChange={(event) => updateForm("imageUrl", event.target.value)} /></label>
          <div className="supplier-form-actions supplier-form-wide"><button className="supplier-primary-button" type="submit" disabled={isSaving}>{isSaving ? "Saving..." : editingId ? "Save changes" : "Create supplier"}</button></div>
        </form>
      </section>

      <section className="supplier-management-panel" aria-labelledby="supplier-list-title">
        <div className="supplier-panel-heading supplier-list-heading">
          <div><p className="eyebrow">SUPPLIER DIRECTORY</p><h2 id="supplier-list-title">All suppliers</h2></div>
          <label className="inactive-toggle"><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} /> Show inactive</label>
        </div>
        <input className="supplier-management-search" type="search" placeholder="Search by supplier name" value={search} onChange={(event) => setSearch(event.target.value)} />
        {notice && <p className="supplier-management-notice" role="status">{notice}</p>}
        {error && <p className="supplier-management-error" role="alert">{error}</p>}
        {isLoading ? <p className="supplier-management-empty">Loading suppliers...</p> : suppliers.length === 0 ? <p className="supplier-management-empty">No suppliers found.</p> : (
          <div className="supplier-table-wrap"><table className="supplier-table"><colgroup><col className="supplier-column-name" /><col className="supplier-column-category" /><col className="supplier-column-location" /><col className="supplier-column-status" /><col className="supplier-column-actions" /></colgroup><thead><tr><th>Name</th><th>Category</th><th>Location</th><th>Status</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>
            {suppliers.map((supplier) => <tr key={supplier._id} className={!supplier.isActive ? "supplier-row-inactive" : undefined}><td><strong>{supplier.name}</strong><small>{supplier.address}</small></td><td>{CATEGORY_LABELS[supplier.category] ?? supplier.category}</td><td>{supplier.building}</td><td><span className={`supplier-status ${supplier.isActive ? "is-active" : "is-inactive"}`}>{supplier.isActive ? "Active" : "Inactive"}</span></td><td className="supplier-row-actions"><button className="supplier-row-button" type="button" onClick={() => startEditing(supplier)}>Edit</button><button className={`supplier-row-button ${supplier.isActive ? "danger" : "reactivate"}`} type="button" disabled={deletingId === supplier._id} onClick={() => requestStatusChange(supplier, supplier.isActive ? "deactivate" : "reactivate")}>{deletingId === supplier._id ? "..." : supplier.isActive ? "Deactivate" : "Reactivate"}</button></td></tr>)}
          </tbody></table></div>
        )}
      </section>

      {statusChange && (
        <div className="supplier-confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setStatusChange(null); }}>
          <section className="supplier-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="supplier-confirm-title">
            <p className="eyebrow">CONFIRM ACTION</p>
            <h2 id="supplier-confirm-title">{statusChange.action === "deactivate" ? "Deactivate supplier?" : "Reactivate supplier?"}</h2>
            <p>{statusChange.action === "deactivate" ? "This supplier will be hidden from active supplier listings." : "This supplier will be available to requesters and couriers again."}</p>
            <div className="supplier-confirm-actions">
              <button className="supplier-secondary-button" type="button" onClick={() => setStatusChange(null)}>Cancel</button>
              <button className={`supplier-primary-button ${statusChange.action === "deactivate" ? "supplier-confirm-danger" : ""}`} type="button" onClick={() => void confirmStatusChange()}>{statusChange.action === "deactivate" ? "Deactivate" : "Reactivate"}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
