import type { Errand } from "../types/errand";
import { formatCredits, timeAgo, timeLeft } from "../utils/errand-format";
import "./ErrandCard.css";

export function SupplierThumb({ errand, className = "errand-card-image" }: { errand: Errand; className?: string }) {
  return (
    <div className={className}>
      {errand.supplier.imageUrl ? (
        <img src={errand.supplier.imageUrl} alt="" loading="lazy" />
      ) : (
        <span aria-hidden="true">{errand.supplier.name.charAt(0)}</span>
      )}
    </div>
  );
}

export default function ErrandCard({
  errand,
  now,
  isOwn,
  onSelect,
}: {
  errand: Errand;
  now: number;
  isOwn: boolean;
  onSelect: (errand: Errand) => void;
}) {
  return (
    <li>
      <button type="button" className="errand-card" onClick={() => onSelect(errand)}>
        <SupplierThumb errand={errand} />
        <div className="errand-card-details">
          <div className="errand-card-top">
            <h2 className="errand-card-name">{errand.supplier.name}</h2>
            <span className="errand-card-reward">{formatCredits(errand.credit)}</span>
          </div>
          <p className="errand-card-route">
            {errand.supplier.building} → {errand.dropoff}
          </p>
          <p className="errand-card-description">{errand.description}</p>
          <p className="errand-card-meta">
            Posted {timeAgo(errand.createdAt, now)} · {timeLeft(errand.expiresAt, now)}
            {isOwn && <span className="errand-card-own">Yours</span>}
          </p>
        </div>
      </button>
    </li>
  );
}
