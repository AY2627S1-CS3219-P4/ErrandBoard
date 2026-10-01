import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";

export default function AccountAdministration() {
  const { user } = useAuth();

  return (
    <main className="admin-dashboard">
      <div className="admin-page-heading">
        <div>
          <Link className="back-link" to="/admin">← Back to dashboard</Link>
          <p className="eyebrow">SUPERADMIN AREA</p>
          <h1>Account Administration</h1>
          <p>Manage administrator access and account status.</p>
        </div>
        <span className="role-badge">{user?.accountType}</span>
      </div>

      <section className="account-admin-panel">
        <div className="section-heading account-admin-heading">
          <div>
            <h2>Accounts</h2>
            <p>Account management actions will be connected to the User Service.</p>
          </div>
          <button className="primary-admin-button" type="button" disabled>
            Create Admin
          </button>
        </div>

        <div className="account-filters" aria-label="Account filters">
          <button className="account-filter active" type="button">All accounts</button>
          <button className="account-filter" type="button" disabled>Admins</button>
          <button className="account-filter" type="button" disabled>Users</button>
        </div>

        <div className="account-empty-state">
          <div className="empty-state-icon">◎</div>
          <h3>No account data loaded</h3>
          <p>The account list and management actions will appear here once the User Service endpoints are connected.</p>
        </div>
      </section>
    </main>
  );
}
