import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";

export default function AdminDashboard() {
  const { user } = useAuth();
  const isSuperadmin = user?.accountType === "SUPERADMIN";

  return (
    <main className="admin-dashboard">
      <div className="admin-page-heading">
        <div>
          <p className="eyebrow">CONTROL CENTRE</p>
          <h1>Admin Dashboard</h1>
          <p>Welcome back, {user?.username}. Here is an overview of ErrandBoard.</p>
        </div>
        <span className="role-badge">{user?.accountType}</span>
      </div>

      <section className="admin-stat-grid" aria-label="Dashboard statistics">
        <article className="admin-stat-card">
          <span>Total users</span>
          <strong>—</strong>
          <small>Coming soon</small>
        </article>
        <article className="admin-stat-card">
          <span>Active suppliers</span>
          <strong>—</strong>
          <small>Coming soon</small>
        </article>
        <article className="admin-stat-card">
          <span>Open errands</span>
          <strong>—</strong>
          <small>Coming soon</small>
        </article>
        <article className="admin-stat-card">
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
        </div>
        <div className="admin-tool-grid">
          <button className="admin-tool-card" type="button" disabled>
            <strong>Supplier management</strong>
            <span>Manage campus suppliers and facilities</span>
            <small>Coming soon</small>
          </button>
          <button className="admin-tool-card" type="button" disabled>
            <strong>Errand oversight</strong>
            <span>Review platform errands and activity</span>
            <small>Coming soon</small>
          </button>
          <button className="admin-tool-card" type="button" disabled>
            <strong>Credit statistics</strong>
            <span>Inspect balances and transaction history</span>
            <small>Coming soon</small>
          </button>
          {isSuperadmin && (
            <Link className="admin-tool-card admin-tool-link" to="/admin/accounts">
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
