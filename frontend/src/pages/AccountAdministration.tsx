import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import type { AccountType } from "../auth/auth-context";
import { apiFetch, userApiUrl } from "../api/client";
import { serviceResponseError, serviceUnavailable } from "../api/service-errors";
import { StatCard, StatGrid } from "../components/StatCard";
import ConfirmModal from "../components/ConfirmModal";
import { getUserStats, type UserStats } from "../api/adminStats";
import "./AdminDashboard.css";
import "./AccountAdministration.css";

type ManagedAccount = { _id: string; email: string; username: string; accountType: "USER" | "ADMIN"; isActive: boolean; createdAt: string };
type Filter = "ALL" | "ADMIN" | "USER";

async function apiError(response: Response): Promise<string> {
  return serviceResponseError(response, "Account management", "Unable to complete the account request.");
}

function statValue(loading: boolean, value: number | undefined): string {
  if (loading) return "…";
  console.log(value);
  return typeof value === "number" ? value.toLocaleString() : "—";
}

export default function AccountAdministration() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [isLoading, setIsLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [stats, setStats] = useState<UserStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  // a privileged action awaiting confirmation (promote to admin, or deactivate an account)
  const [pendingAction, setPendingAction] = useState<{ account: ManagedAccount; kind: "promote" | "deactivate" } | null>(null);

  const loadAccounts = useCallback(async () => {
    setIsLoading(true); setError("");
    try {
      const response = await apiFetch(userApiUrl("/accounts"), { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(await apiError(response));
      const body = await response.json() as { accounts: ManagedAccount[] };
      setAccounts(body.accounts);
    } catch (requestError) { setError(requestError instanceof TypeError ? serviceUnavailable("Account management") : requestError instanceof Error ? requestError.message : "Unable to load accounts."); }
    finally { setIsLoading(false); }
  }, []);

  const loadStats = useCallback(async (signal?: AbortSignal) => {
    // `statsLoading` starts true; the flag is cleared once the fetch settles.
    try {
      setStats(await getUserStats(signal));
    } catch {
      if (!signal?.aborted) setStats(null); // leave cards as "—" if stats fail; the table still works
    } finally {
      if (!signal?.aborted) setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void loadAccounts(); });
    return () => { active = false; };
  }, [loadAccounts]);

  useEffect(() => {
    const controller = new AbortController();
    // defer out of the synchronous effect body (matches the loadAccounts effect above)
    queueMicrotask(() => { if (!controller.signal.aborted) void loadStats(controller.signal); });
    return () => controller.abort();
  }, [loadStats]);
  const visibleAccounts = useMemo(() => filter === "ALL" ? accounts : accounts.filter((account) => account.accountType === filter), [accounts, filter]);

  async function changeRole(account: ManagedAccount) {
    const nextRole: AccountType = account.accountType === "ADMIN" ? "USER" : "ADMIN";
    setUpdatingId(account._id); setError(""); setNotice("");
    try {
      const response = await apiFetch(userApiUrl(`/accounts/${account._id}/role`), { method: "PATCH", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ accountType: nextRole }) });
      if (!response.ok) throw new Error(await apiError(response));
      setNotice(`${account.username} is now an ${nextRole === "ADMIN" ? "Admin" : "User"}.`);
      await Promise.all([loadAccounts(), loadStats()]);
    } catch (requestError) { setError(requestError instanceof TypeError ? serviceUnavailable("Account management") : requestError instanceof Error ? requestError.message : "Unable to update account role."); }
    finally { setUpdatingId(null); }
  }

  async function changeStatus(account: ManagedAccount) {
    const isActive = !account.isActive;
    setUpdatingId(account._id); setError(""); setNotice("");
    try {
      const response = await apiFetch(userApiUrl(`/accounts/${account._id}/status`), { method: "PATCH", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ isActive }) });
      if (!response.ok) throw new Error(await apiError(response));
      setNotice(`${account.username} is now ${isActive ? "active" : "inactive"}.`);
      await Promise.all([loadAccounts(), loadStats()]);
    } catch (requestError) { setError(requestError instanceof TypeError ? serviceUnavailable("Account management") : requestError instanceof Error ? requestError.message : "Unable to update account status."); }
    finally { setUpdatingId(null); }
  }

  // runs the confirmed privileged action, then dismisses the modal
  async function confirmPendingAction() {
    if (!pendingAction) return;
    const { account, kind } = pendingAction;
    await (kind === "promote" ? changeRole(account) : changeStatus(account));
    setPendingAction(null);
  }

  return (
    <main className="admin-dashboard account-administration-page">
      <Link className="admin-back-button" to="/admin"><span aria-hidden="true">←</span>Back to dashboard</Link>
      <div className="admin-page-heading"><div><p className="eyebrow">ERRANDBOARD / SUPERADMIN</p><h1>Account Administration</h1><p>Review platform accounts and manage administrator access.</p></div><span className="role-badge"><span className="role-dot" />{user?.accountType}</span></div>
      <StatGrid variant="auto" aria-label="Account statistics">
        <StatCard icon="USERS" label="Total accounts" value={statValue(statsLoading, stats?.totalUsers)} caption="All roles" />
        <StatCard icon="ACTIVE" label="Active" value={statValue(statsLoading, stats?.activeUsers)} caption="Not deactivated" />
        <StatCard icon="OFF" label="Inactive" value={statValue(statsLoading, stats?.inactiveUsers)} caption="Deactivated" />
        <StatCard icon="ADMIN" label="Admins" value={statValue(statsLoading, stats?.admins)} caption="ADMIN role" />
        <StatCard icon="USER" label="Users" value={statValue(statsLoading, stats?.users)} caption="USER role" />
      </StatGrid>
      <section className="account-admin-panel" aria-labelledby="account-list-title">
        <div className="section-heading account-admin-heading"><div><p className="eyebrow">ACCESS CONTROL</p><h2 id="account-list-title">Accounts</h2></div><div className="account-summary"><strong>{accounts.length}</strong><span>managed accounts</span></div></div>
        <div className="account-filters" aria-label="Account filters">{(["ALL", "ADMIN", "USER"] as Filter[]).map((value) => <button key={value} className={`account-filter ${filter === value ? "active" : ""}`} type="button" onClick={() => setFilter(value)}>{value === "ALL" ? "All accounts" : `${value === "ADMIN" ? "Admins" : "Users"} (${accounts.filter((account) => account.accountType === value).length})`}</button>)}</div>
        {notice && <p className="account-notice" role="status">{notice}</p>}
        {error && <p className="account-error" role="alert">{error}</p>}
        {isLoading ? <p className="account-empty-state">Loading accounts...</p> : visibleAccounts.length === 0 ? <p className="account-empty-state">No accounts found.</p> : <div className="account-table-wrap"><table className="account-table"><thead><tr><th>Account</th><th>Email</th><th>Role</th><th>Status</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>{visibleAccounts.map((account) => <tr key={account._id}><td data-label="Account"><strong>{account.username}</strong><small>Joined {new Date(account.createdAt).toLocaleDateString()}</small></td><td data-label="Email">{account.email}</td><td data-label="Role"><span className={`account-role-badge ${account.accountType === "ADMIN" ? "admin" : "user"}`}>{account.accountType}</span></td><td data-label="Status"><span className={`account-status-badge ${account.isActive ? "active" : "inactive"}`}>{account.isActive ? "Active" : "Inactive"}</span></td><td className="account-row-actions"><button className={`account-role-button ${account.accountType === "ADMIN" ? "demote" : "promote"}`} type="button" disabled={updatingId === account._id} onClick={() => account.accountType === "ADMIN" ? void changeRole(account) : setPendingAction({ account, kind: "promote" })}>{updatingId === account._id ? "Updating..." : account.accountType === "ADMIN" ? "Demote to User" : "Promote to Admin"}</button><button className={`account-role-button account-status-button ${account.isActive ? "demote" : "promote"}`} type="button" disabled={updatingId === account._id} onClick={() => account.isActive ? setPendingAction({ account, kind: "deactivate" }) : void changeStatus(account)}>{updatingId === account._id ? "Updating..." : account.isActive ? "Deactivate" : "Activate"}</button></td></tr>)}</tbody></table></div>}
      </section>

      {pendingAction && (
        <ConfirmModal
          title={pendingAction.kind === "promote" ? "Promote to Admin?" : "Deactivate account?"}
          message={
            pendingAction.kind === "promote"
              ? `${pendingAction.account.username} will gain Admin privileges, including access to the admin dashboard.`
              : `${pendingAction.account.username} will be signed out and blocked from accessing the platform until reactivated.`
          }
          confirmLabel={pendingAction.kind === "promote" ? "Promote" : "Deactivate"}
          tone={pendingAction.kind === "deactivate" ? "danger" : "default"}
          busy={updatingId === pendingAction.account._id}
          onConfirm={() => void confirmPendingAction()}
          onClose={() => setPendingAction(null)}
        />
      )}
    </main>
  );
}
