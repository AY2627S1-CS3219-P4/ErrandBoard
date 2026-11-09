import type { ReactNode } from "react";

// Presentational stat card matching the admin dashboard markup contract defined in
// AdminDashboard.css (.admin-stat-card: a .stat-icon, a label, a <strong> value, a <small>
// caption). Keep this in sync with that stylesheet, which every admin page imports.

export interface StatCardProps {
  /** Short mono label shown top-right, e.g. "01" or "USERS". */
  icon: ReactNode;
  /** Card label, e.g. "Total users". */
  label: ReactNode;
  /** The value; pass "—" (the default) while loading or on failure. */
  value?: ReactNode;
  /** Optional caption under the value. */
  caption?: ReactNode;
}

export function StatCard({ icon, label, value = "—", caption }: StatCardProps) {
  return (
    <article className="admin-stat-card">
      <span className="stat-icon">{icon}</span>
      <span>{label}</span>
      <strong>{value}</strong>
      {caption != null && <small>{caption}</small>}
    </article>
  );
}

export interface StatGridProps {
  children: ReactNode;
  /** Fixed 4-column layout (dashboard) by default; `auto` wraps a variable number of cards (tabs). */
  variant?: "fixed" | "auto";
  "aria-label"?: string;
}

export function StatGrid({ children, variant = "fixed", "aria-label": ariaLabel }: StatGridProps) {
  const className = variant === "auto" ? "admin-stat-grid admin-stat-grid--auto" : "admin-stat-grid";
  return (
    <section className={className} aria-label={ariaLabel}>
      {children}
    </section>
  );
}
