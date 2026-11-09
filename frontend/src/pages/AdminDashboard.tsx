import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { StatCard, StatGrid } from "../components/StatCard";
import { getAdminStats, type AdminStats } from "../api/adminStats";
import "./AdminDashboard.css";

// Render a loaded number, or "—" while loading / when that service's stats failed to load.
function statValue(loading: boolean, value: number | undefined): string {
  if (loading) return "…";
  return typeof value === "number" ? value.toLocaleString() : "—";
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const isSuperadmin = user?.accountType === "SUPERADMIN";

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    getAdminStats(controller.signal)
      .then((result) => setStats(result))
      .catch(() => { /* getAdminStats swallows per-service failures; a throw here is an aborted load */ })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);

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

      <StatGrid aria-label="Dashboard statistics">
        <StatCard
          icon="01"
          label="Total users"
          value={statValue(loading, stats?.users?.activeUsers)}
          caption="Active accounts"
        />
        <StatCard
          icon="02"
          label="Active suppliers"
          value={statValue(loading, stats?.suppliers?.activeSuppliers)}
          caption="Currently listed"
        />
        <StatCard
          icon="03"
          label="Open errands"
          value={statValue(loading, stats?.errands?.openActive)}
          caption="Awaiting a courier"
        />
        <StatCard
          icon="04"
          label="Credits in system"
          value={statValue(loading, stats?.credits?.totalCredits)}
          caption="Available + reserved"
        />
      </StatGrid>

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
          <Link className="admin-tool-card admin-tool-link" to="/admin/disputes">
            <span className="tool-card-label">ACTIVITY</span>
            <strong>Errand oversight</strong>
            <span>Review platform errands and resolve disputes</span>
            <small>Open errand oversight</small>
          </Link>
          <Link className="admin-tool-card admin-tool-link" to="/admin/credits">
            <span className="tool-card-label">FINANCE</span>
            <strong>Credit statistics</strong>
            <span>Inspect balances and transaction history</span>
            <small>Open credit statistics</small>
          </Link>
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
