import { useMemo, useRef, useState, type SubmitEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import * as common from "@zxcvbn-ts/language-common";
import * as english from "@zxcvbn-ts/language-en";
import "./Settings.css";

const API_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";
const PASSWORD_SCORE_LABELS = ["Very weak", "Weak", "Fair", "Strong", "Very strong"] as const;
const estimator = new ZxcvbnFactory({
  translations: english.translations, graphs: common.adjacencyGraphs,
  dictionary: { ...common.dictionary, ...english.dictionary },
});
function checkPassword(value: string) {
  const byteLength = new TextEncoder().encode(value).length;
  const characterLength = Array.from(value).length;
  const score = value && byteLength <= 72 ? estimator.check(value).score : 0;
  return { byteLength, characterLength, score, valid: characterLength >= 10 && byteLength <= 72 && score >= 3 };
}
async function responseError(response: Response) {
  const body = await response.json().catch(() => null);
  return typeof body?.error === "string" ? body.error : "Unable to update your account. Please try again.";
}

export default function Settings() {
  const { user, logout, refreshAuth } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState(user?.username ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [usernameNotice, setUsernameNotice] = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordNotice, setPasswordNotice] = useState("");
  const [logoutError, setLogoutError] = useState("");
  const [unsavedNotice, setUnsavedNotice] = useState("");
  const [busy, setBusy] = useState<"username" | "password" | "logout" | null>(null);
  const usernameInput = useRef<HTMLInputElement>(null);
  const isEditingUsername = username !== user?.username;
  const passwordCheck = useMemo(() => checkPassword(newPassword), [newPassword]);
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;

  function blockLeaveForUnsavedUsername() {
    if (!isEditingUsername) return false;
    setUnsavedNotice("You have unsaved username changes. Save or revert them before leaving Settings.");
    usernameInput.current?.focus();
    usernameInput.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    return true;
  }

  async function sessionExpired() {
    await refreshAuth(false);
    navigate("/login", { replace: true, state: { message: "Your session has expired. Please log in again." } });
  }

  async function handleUsernameSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("username");
    setUsernameNotice("");
    setUsernameError("");
    try {
      const response = await fetch(`${API_URL}/auth/me/username`, {
        credentials: "include", headers: { "Content-Type": "application/json" },
        method: "PATCH", body: JSON.stringify({ username }),
      });
      if (response.status === 401) { await sessionExpired(); return; }
      if (!response.ok) { setUsernameError(await responseError(response)); return; }
      const body = await response.json();
      await refreshAuth(false);
      setUsernameNotice(body.message);
      setUnsavedNotice("");
    } catch {
      setUsernameError("Could not update your username. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function handlePasswordSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!passwordCheck.valid || newPassword !== confirmPassword) {
      setPasswordError("Choose a strong password and enter it identically in both fields.");
      return;
    }
    setBusy("password");
    setPasswordError("");
    setPasswordNotice("");
    try {
      const response = await fetch(`${API_URL}/auth/me/password`, {
        credentials: "include", headers: { "Content-Type": "application/json" },
        method: "PATCH", body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (response.status === 401) { await sessionExpired(); return; }
      if (!response.ok) { setPasswordError(await responseError(response)); return; }
      setPasswordNotice("Password updated. Use your new password the next time you log in.");
    } catch {
      setPasswordError("Could not confirm the password change. If it succeeded, log in with your new password.");
    } finally {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setBusy(null);
    }
  }

  async function handleLogout() {
    if (blockLeaveForUnsavedUsername()) return;
    setBusy("logout");
    setLogoutError("");
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch {
      setLogoutError("We could not complete logout. Please try again.");
    } finally { setBusy(null); }
  }

  return (
    <main className="settings-shell">
      <header className="app-page-header">
        <Link className="settings-back-link" to="/home" onClick={(event) => {
          if (blockLeaveForUnsavedUsername()) event.preventDefault();
        }}>← Home</Link>
        <h1>Settings</h1>
        <button className="settings-logout-button" type="button" onClick={handleLogout} disabled={busy !== null}>
          {busy === "logout" ? "Logging out…" : "Log out"}
        </button>
      </header>
      {logoutError && <p className="settings-error" role="alert">{logoutError}</p>}
      {unsavedNotice && <p className="settings-error" role="alert">{unsavedNotice}</p>}

      <div className="account-settings">
        <div className="settings-intro">
          <h2>Account</h2>
          <p>Manage your sign-in details.</p>
        </div>
        <section className="settings-section" aria-labelledby="username-settings-title">
          <h3 id="username-settings-title">Username</h3>
          <form className="settings-form" onSubmit={handleUsernameSubmit}>
            <div className="username-edit-row">
              <input ref={usernameInput} id="new-username" name="username" type="text" autoComplete="username"
                minLength={3} maxLength={30} pattern="[A-Za-z0-9_]{3,30}"
                placeholder="3–30 letters, numbers, or underscores" value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  setUsernameError("");
                  setUsernameNotice("");
                  setUnsavedNotice("");
                }}
                required />
              <button className="settings-primary-button" type="submit"
                disabled={busy !== null || !isEditingUsername}>
                {busy === "username" ? "Saving…" : "Save"}
              </button>
            </div>
            {usernameNotice && <p className="settings-notice" role="status">{usernameNotice}</p>}
            {usernameError && <p className="settings-error" role="alert">{usernameError}</p>}
          </form>
        </section>

        <section className="settings-section" aria-labelledby="password-settings-title">
          <h3 id="password-settings-title">Password</h3>
          <p className="settings-help">Confirm your current password before choosing a new one.</p>
          <form className="settings-form" onSubmit={handlePasswordSubmit}>
            <label htmlFor="current-password">Current password</label>
            <input id="current-password" type="password" autoComplete="current-password"
              value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
            <label htmlFor="new-password">New password</label>
            <input id="new-password" type="password" autoComplete="new-password"
              placeholder="At least 10 characters; strong or better" value={newPassword}
              onChange={(event) => { setNewPassword(event.target.value); setPasswordError(""); }}
              aria-describedby="settings-password-strength" required />
            <p id="settings-password-strength" className="settings-help" role="status">
              {newPassword
                ? (passwordCheck.byteLength > 72 ? "Password is too long (maximum 72 UTF-8 bytes)."
                  : "Strength: " + PASSWORD_SCORE_LABELS[passwordCheck.score] + (passwordCheck.characterLength < 10 ? ". Use at least 10 characters." : "."))
                : "Use a unique password that you do not use on other sites."}
            </p>
            <label htmlFor="confirm-password">Confirm new password</label>
            <input id="confirm-password" type="password" autoComplete="new-password"
              placeholder="Re-enter your new password" value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              aria-invalid={mismatch} aria-describedby={mismatch ? "settings-confirm-error" : undefined} required />
            {mismatch && <p id="settings-confirm-error" className="settings-error" role="status">Passwords do not match.</p>}
            <div className="settings-action-row">
              <button className="settings-primary-button" type="submit"
                disabled={busy !== null || !passwordCheck.valid || newPassword !== confirmPassword || !currentPassword}>
                {busy === "password" ? "Changing…" : "Change password"}
              </button>
            </div>
            {passwordNotice && <p className="settings-notice" role="status">{passwordNotice}</p>}
            {passwordError && <p className="settings-error" role="alert">{passwordError}</p>}
          </form>
        </section>
      </div>
    </main>
  );
}
