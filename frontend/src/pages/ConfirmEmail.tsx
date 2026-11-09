import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch, userApiUrl } from "../api/client";
import "./AuthForm.css";

export default function ConfirmEmail() {
  const navigate = useNavigate();
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
  const [message, setMessage] = useState(/^[a-f0-9]{64}$/.test(token)
    ? "" : "This confirmation link is invalid. Request another email.");
  const [submitting, setSubmitting] = useState(false);

  async function confirm() {
    setSubmitting(true);
    try {
      const response = await apiFetch(userApiUrl("/auth/verify-email/confirm"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!response.ok) {
        setMessage(response.status === 400
          ? "This confirmation link is invalid or expired. Request another email."
          : "Could not confirm your email right now. Please try again later.");
        return;
      }
      window.history.replaceState(null, "", "/confirm-email");
      navigate("/login", { replace: true, state: { notice: "Email confirmed. You can now log in." } });
    } catch {
      setMessage("Could not confirm your email right now. Please try again later.");
    } finally {
      setSubmitting(false);
    }
  }

  return <main className="auth-page">
    <h1>Confirm your email</h1>
    <div className="auth-card">
      <p>Confirm your email address to activate your account.</p>
      {message && <p className="auth-tip auth-form-error" role="alert">{message}</p>}
      <button className="auth-submit" type="button" onClick={confirm}
        disabled={submitting || !/^[a-f0-9]{64}$/.test(token)}>
        {submitting ? "Confirming..." : "Confirm email"}
      </button>
    </div>
    <p className="auth-alternate-link"><Link to="/check-email">Request another email</Link></p>
  </main>;
}
