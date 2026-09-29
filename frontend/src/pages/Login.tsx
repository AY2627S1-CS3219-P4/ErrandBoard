import { useState, type SubmitEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import "./AuthForm.css";

const API_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export default function Login() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });

      const responseText = await response.text();
      let responseBody: unknown = responseText;

      try {
        responseBody = responseText ? JSON.parse(responseText) : undefined;
      } catch {
        // Keep the raw response text for debugging non-JSON errors.
      }

      if (import.meta.env.DEV) {
        console.debug("User Service login response", {
          url: `${API_URL}/auth/login`,
          status: response.status,
          statusText: response.statusText,
          body: responseBody,
        });
      }

      if (!response.ok) {
        const serverMessage =
          typeof responseBody === "object" && responseBody !== null &&
          "error" in responseBody && typeof responseBody.error === "string"
            ? responseBody.error
            : undefined;

        setError(
          import.meta.env.DEV && serverMessage
            ? `${serverMessage} (HTTP ${response.status})`
            : "Invalid email or password.",
        );
        return;
      }

      navigate("/home");
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Unable to reach the User Service", {
          url: `${API_URL}/auth/login`,
          error,
        });
      }

      setError(
        import.meta.env.DEV && error instanceof Error
          ? `Unable to reach the User Service: ${error.message}`
          : "Unable to reach the User Service.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <h1>Login</h1>

      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-field">
          <div className="auth-field-heading">
            <label htmlFor="login-email">Email</label>
          </div>
          <input
            id="login-email"
            type="email"
            placeholder="e.g. e1234567@u.nus.edu"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>

        <div className="auth-field">
          <div className="auth-field-heading">
            <label htmlFor="login-password">Password</label>
          </div>
          <input
            id="login-password"
            type="password"
            placeholder="Enter your password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </div>

        {error && <p className="auth-tip auth-form-error" role="alert">{error}</p>}

        <button className="auth-submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Logging in..." : "Login"}
        </button>
      </form>

      <p className="auth-alternate-link">
        Need an account? <Link to="/register">Register</Link>
      </p>
    </main>
  );
}
