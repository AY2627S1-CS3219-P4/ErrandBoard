import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import type { AccountType } from "../auth/auth-context";
import "./AdminDashboard.css";
import "./AccountAdministration.css";

const API_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";
type ManagedAccount = { _id: string; email: string; username: string; accountType: "USER" | "ADMIN"; isActive: boolean; createdAt: string };
type Filter = "ALL" | "ADMIN" | "USER";

async function apiError(response: Response): Promise<string> {
  try { const body = await response.json() as { error?: string }; if (body.error) return body.error; } catch { /* use status */ }
  return `User Service responded with HTTP ${response.status}.`;
}

export default function AccountAdministration() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [isLoading, setIsLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadAccounts = useCallback(async () => {
    setIsLoading(true); setError("");
    try {
      const response = await fetch(`${API_URL}/accounts`, { credentials: "include", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(await apiError(response));
      const body = await response.json() as { accounts: ManagedAccount[] };
      setAccounts(body.accounts);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to load accounts."); }
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => { void loadAccounts(); }, [loadAccounts]);
  const visibleAccounts = useMemo(() => filter === "ALL" ? accounts : accounts.filter((account) => account.accountType === filter), [accounts, filter]);

  async function changeRole(account: ManagedAccount) {
    const nextRole: AccountType = account.accountType === "ADMIN" ? "USER" : "ADMIN";
    setUpdatingId(account._id); setError(""); setNotice("");
    try {
      const response = await fetch(`${API_URL}/accounts/${account._id}/role`, { method: "PATCH", credentials: "include", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ accountType: nextRole }) });
      if (!response.ok) throw new Error(await apiError(response));
      setNotice(`${account.username} is now an ${nextRole === "ADMIN" ? "Admin" : "User"}.`);
      await loadAccounts();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to update account role."); }
    finally { setUpdatingId(null); }
  }

  async function changeStatus(account: ManagedAccount) {
    const isActive = !account.isActive;
    setUpdatingId(account._id); setError(""); setNotice("");
    try {
      const response = await fetch(`${API_URL}/accounts/${account._id}/status`, { method: "PATCH", credentials: "include", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ isActive }) });
      if (!response.ok) throw new Error(await apiError(response));
      setNotice(`${account.username} is now ${isActive ? "active" : "inactive"}.`);
      await loadAccounts();
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Unable to update account status."); }
    finally { setUpdatingId(null); }
  }

  return (
    <main className="admin-dashboard account-administration-page">
      <Link className="admin-back-button" to="/admin"><span aria-hidden="true">←</span>Back to dashboard</Link>
      <div className="admin-page-heading"><div><p className="eyebrow">ERRANDBOARD / SUPERADMIN</p><h1>Account Administration</h1><p>Review platform accounts and manage administrator access.</p></div><span className="role-badge"><span className="role-dot" />{user?.accountType}</span></div>
      <section className="account-admin-panel" aria-labelledby="account-list-title">
        <div className="section-heading account-admin-heading"><div><p className="eyebrow">ACCESS CONTROL</p><h2 id="account-list-title">Accounts</h2></div><div className="account-summary"><strong>{accounts.length}</strong><span>managed accounts</span></div></div>
        <div className="account-filters" aria-label="Account filters">{(["ALL", "ADMIN", "USER"] as Filter[]).map((value) => <button key={value} className={`account-filter ${filter === value ? "active" : ""}`} type="button" onClick={() => setFilter(value)}>{value === "ALL" ? "All accounts" : `${value === "ADMIN" ? "Admins" : "Users"} (${accounts.filter((account) => account.accountType === value).length})`}</button>)}</div>
        {notice && <p className="account-notice" role="status">{notice}</p>}
        {error && <p className="account-error" role="alert">{error}</p>}
        {isLoading ? <p className="account-empty-state">Loading accounts...</p> : visibleAccounts.length === 0 ? <p className="account-empty-state">No accounts found.</p> : <div className="account-table-wrap"><table className="account-table"><thead><tr><th>Account</th><th>Email</th><th>Role</th><th>Status</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>{visibleAccounts.map((account) => <tr key={account._id}><td><strong>{account.username}</strong><small>Joined {new Date(account.createdAt).toLocaleDateString()}</small></td><td>{account.email}</td><td><span className={`account-role-badge ${account.accountType === "ADMIN" ? "admin" : "user"}`}>{account.accountType}</span></td><td><span className={`account-status-badge ${account.isActive ? "active" : "inactive"}`}>{account.isActive ? "Active" : "Inactive"}</span></td><td className="account-row-actions"><button className={`account-role-button ${account.accountType === "ADMIN" ? "demote" : "promote"}`} type="button" disabled={updatingId === account._id} onClick={() => void changeRole(account)}>{updatingId === account._id ? "Updating..." : account.accountType === "ADMIN" ? "Demote to User" : "Promote to Admin"}</button><button className={`account-role-button account-status-button ${account.isActive ? "demote" : "promote"}`} type="button" disabled={updatingId === account._id} onClick={() => void changeStatus(account)}>{updatingId === account._id ? "Updating..." : account.isActive ? "Deactivate" : "Activate"}</button></td></tr>)}</tbody></table></div>}
      </section>
    </main>
  );
}
