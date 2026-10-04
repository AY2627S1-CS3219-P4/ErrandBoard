import { useState, type SubmitEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { apiFetch, userApiUrl } from "../api/client";
import "./AuthForm.css";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshAuth } = useAuth();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(
    typeof location.state?.message === "string" ? location.state.message : "",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await apiFetch(userApiUrl("/auth/login"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ username, password }),
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
          url: userApiUrl("/auth/login"),
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
            : "Invalid username or password.",
        );
        return;
      }

      const authenticated = await refreshAuth(false);
      if (!authenticated) {
        setError("Login succeeded, but your session could not be verified. Please try again.");
        return;
      }
      navigate("/home", { replace: true });
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error("Unable to reach the User Service", {
          url: userApiUrl("/auth/login"),
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
            <label htmlFor="login-username">Username</label>
          </div>
          <input
            id="login-username"
            type="text"
            autoComplete="username"
            placeholder="Enter your username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
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
