import { useState, type SubmitEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { apiFetch, userApiUrl } from "../api/client";
import { isValidRegistrationEmail, normalizeRegistrationEmail } from "../auth/registration-email";
import "./AuthForm.css";

export default function CheckEmail() {
  const location = useLocation();
  const [email, setEmail] = useState(typeof location.state?.email === "string" ? location.state.email : "");
  const [message, setMessage] = useState(location.state?.deliveryPending
    ? "Your account was created, but the confirmation email could not be sent. Please try resending it."
    : "Check your email for a confirmation link before logging in.");
  const [sending, setSending] = useState(false);

  async function resend(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isValidRegistrationEmail(email)) return;
    setSending(true);
    try {
      const response = await apiFetch(userApiUrl("/auth/verify-email/resend"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizeRegistrationEmail(email) }),
      });
      if (!response.ok) throw new Error("Resend unavailable");
      setMessage("If this address has an unverified account, a confirmation email will be sent when eligible.");
    } catch {
      setMessage("Could not request another email right now. Please try again later.");
    } finally {
      setSending(false);
    }
  }

  return <main className="auth-page">
    <h1>Confirm your email</h1>
    <form className="auth-card" onSubmit={resend}>
      <p role="status">{message}</p>
      <div className="auth-field">
        <label htmlFor="confirmation-email">NUS email</label>
        <input id="confirmation-email" type="email" value={email}
          onChange={(event) => setEmail(event.target.value)} required />
      </div>
      <button className="auth-submit" type="submit" disabled={sending || !isValidRegistrationEmail(email)}>
        {sending ? "Requesting..." : "Resend confirmation email"}
      </button>
    </form>
    <p className="auth-alternate-link"><Link to="/login">Back to login</Link></p>
  </main>;
}
