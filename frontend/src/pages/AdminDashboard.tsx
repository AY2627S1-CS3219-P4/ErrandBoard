import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import "./AdminDashboard.css";

export default function AdminDashboard() {
  const { user } = useAuth();
  const isSuperadmin = user?.accountType === "SUPERADMIN";

  return (
    <main className="admin-dashboard">
      <div className="admin-page-heading">
        <div>
          <p className="eyebrow">ERRANDBOARD / CONTROL CENTRE</p>
          <h1>Admin Dashboard</h1>
          <p>Welcome back, {user?.username}. Here is an overview of ErrandBoard.</p>
        </div>
        <span className="role-badge"><span className="role-dot" />{user?.accountType}</span>
      </div>

      <section className="admin-stat-grid" aria-label="Dashboard statistics">
        <article className="admin-stat-card">
          <span className="stat-icon">01</span>
          <span>Total users</span>
          <strong>—</strong>
          <small>Coming soon</small>
        </article>
        <article className="admin-stat-card">
          <span className="stat-icon">02</span>
          <span>Active suppliers</span>
          <strong>—</strong>
          <small>Coming soon</small>
        </article>
        <article className="admin-stat-card">
          <span className="stat-icon">03</span>
          <span>Open errands</span>
          <strong>—</strong>
          <small>Coming soon</small>
        </article>
        <article className="admin-stat-card">
          <span className="stat-icon">04</span>
          <span>Credits in system</span>
          <strong>—</strong>
          <small>Coming soon</small>
        </article>
      </section>

      <section className="admin-tools-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">ADMINISTRATION</p>
            <h2>Management tools</h2>
          </div>
          <p className="section-description">Everything you need to keep the platform running smoothly.</p>
        </div>
        <div className="admin-tool-grid">
          <Link className="admin-tool-card admin-tool-link" to="/admin/suppliers">
            <span className="tool-card-label">PLATFORM</span>
            <strong>Supplier management</strong>
            <span>Manage campus suppliers and facilities</span>
            <small>Open management tools</small>
          </Link>
          <button className="admin-tool-card" type="button" disabled>
            <span className="tool-card-label">ACTIVITY</span>
            <strong>Errand oversight</strong>
            <span>Review platform errands and activity</span>
            <small>Coming soon</small>
          </button>
          <button className="admin-tool-card" type="button" disabled>
            <span className="tool-card-label">FINANCE</span>
            <strong>Credit statistics</strong>
            <span>Inspect balances and transaction history</span>
            <small>Coming soon</small>
          </button>
          {isSuperadmin && (
            <Link className="admin-tool-card admin-tool-link" to="/admin/accounts">
              <span className="tool-card-label">SUPERADMIN</span>
              <strong>Account administration</strong>
              <span>Create, review, and manage privileged accounts</span>
              <small>Superadmin only</small>
            </Link>
          )}
        </div>
      </section>
    </main>
  );
}
