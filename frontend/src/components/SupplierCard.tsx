import { CATEGORY_LABELS, type Supplier } from "../types/supplier";
import "./SupplierCard.css";
import { Link } from "react-router-dom";

export default function SupplierCard({ supplier }: { supplier: Supplier }) {
  return (
    <li>
      <Link className="supplier-card" to={`/supplier/${supplier._id}`}>
        <div className="supplier-card-image">
          {supplier.imageUrl ? (
            <img src={supplier.imageUrl} alt="" loading="lazy" />
          ) : (
            <span aria-hidden="true">{supplier.name.charAt(0)}</span>
          )}
        </div>
        <div className="supplier-card-details">
          <h2 className="supplier-card-name">{supplier.name}</h2>
          <p className="supplier-card-meta">
            {CATEGORY_LABELS[supplier.category] ?? supplier.category} • {supplier.building}
          </p>
        </div>
      </Link>
    </li>
  );
}
