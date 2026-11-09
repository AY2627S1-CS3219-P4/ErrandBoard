import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { StatCard, StatGrid } from "../components/StatCard";
import { CreditHistogram } from "../components/CreditHistogram";
import { getCreditStats, type CreditStats } from "../api/adminStats";
import "./AdminDashboard.css";
import "./AccountAdministration.css";

function statValue(loading: boolean, value: number | undefined): string {
  if (loading) return "…";
  return typeof value === "number" ? value.toLocaleString() : "—";
}

export default function CreditStatistics() {
  const { user } = useAuth();
  const [stats, setStats] = useState<CreditStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    getCreditStats(controller.signal)
      .then((result) => setStats(result))
      .catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  return (
    <main className="admin-dashboard account-administration-page">
      <Link className="admin-back-button" to="/admin"><span aria-hidden="true">←</span>Back to dashboard</Link>
      <div className="admin-page-heading">
        <div>
          <p className="eyebrow">ERRANDBOARD / ADMIN</p>
          <h1>Credit Statistics</h1>
          <p>Platform-wide credit balances and lifetime movement.</p>
        </div>
        <span className="role-badge"><span className="role-dot" />{user?.accountType}</span>
      </div>

      {failed && <p className="account-error" role="alert">Credit statistics are temporarily unavailable. Please try again.</p>}

      <section className="account-admin-panel" aria-labelledby="credit-balances-title">
        <div className="section-heading account-admin-heading">
          <div>
            <p className="eyebrow">BALANCES</p>
            <h2 id="credit-balances-title">Credits in system</h2>
          </div>
        </div>
        <StatGrid variant="auto" aria-label="Credit balance statistics">
          <StatCard icon="TOTAL" label="Total credits" value={statValue(loading, stats?.totalCredits)} caption="Available + reserved" />
          <StatCard icon="AVL" label="Available" value={statValue(loading, stats?.available)} caption="Spendable now" />
          <StatCard icon="RSV" label="Reserved" value={statValue(loading, stats?.reserve)} caption="Held against errands" />
        </StatGrid>
      </section>

      <section className="account-admin-panel" aria-labelledby="credit-accounts-title">
        <div className="section-heading account-admin-heading">
          <div>
            <p className="eyebrow">ACCOUNTS</p>
            <h2 id="credit-accounts-title">Credit accounts</h2>
          </div>
        </div>
        <StatGrid variant="auto" aria-label="Credit account statistics">
          <StatCard icon="ACCT" label="Total accounts" value={statValue(loading, stats?.accounts)} caption="Provisioned wallets" />
          <StatCard icon="ACTIVE" label="Active accounts" value={statValue(loading, stats?.activeAccounts)} caption="Currently active" />
        </StatGrid>
        <CreditHistogram bins={stats?.availableDistribution ?? []} total={stats?.accounts ?? 0} loading={loading} />
      </section>

      <section className="account-admin-panel" aria-labelledby="credit-movement-title">
        <div className="section-heading account-admin-heading">
          <div>
            <p className="eyebrow">LIFETIME MOVEMENT</p>
            <h2 id="credit-movement-title">Transactions</h2>
          </div>
        </div>
        <StatGrid variant="auto" aria-label="Credit movement statistics">
          <StatCard icon="XFER" label="Transferred" value={statValue(loading, stats?.transferred)} caption="Paid out to couriers" />
          <StatCard icon="RFND" label="Refunded" value={statValue(loading, stats?.refunded)} caption="Returned to requesters" />
        </StatGrid>
      </section>
    </main>
  );
}
