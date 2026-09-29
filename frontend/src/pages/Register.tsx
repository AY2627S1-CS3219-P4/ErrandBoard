import { useMemo, useState, type SubmitEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import * as common from "@zxcvbn-ts/language-common";
import * as english from "@zxcvbn-ts/language-en";
import "./AuthForm.css";

const API_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

const EMAIL_REGEX: RegExp = /^e\d{7}@u\.nus\.edu$/;
const USER_REGEX: RegExp = /^[a-zA-Z0-9_]{3,30}$/;
const MIN_PASSWORD_CHARACTERS = 10;
const MAX_PASSWORD_BYTES = 72;
const MIN_ACCEPTABLE_PASSWORD_SCORE = 3;
const PASSWORD_SCORE_LABELS = [
  "Very weak",
  "Weak",
  "Fair",
  "Strong",
  "Very strong",
] as const;

const passwordEstimator = new ZxcvbnFactory({
  translations: english.translations,
  graphs: common.adjacencyGraphs,
  dictionary: {
    ...common.dictionary,
    ...english.dictionary,
  },
});

function validateEmail(value: string): boolean {
  return EMAIL_REGEX.test(value);
}

function validateUsername(value: string): boolean {
  return USER_REGEX.test(value);
}

function checkPassword(value: string) {
  const byteLength = new TextEncoder().encode(value).length;
  const result = value ? passwordEstimator.check(value) : null;
  const score = result?.score ?? 0;
  const characterLength = Array.from(value).length;

  return {
    byteLength,
    characterLength,
    score,
    valid:
      characterLength >= MIN_PASSWORD_CHARACTERS &&
      byteLength <= MAX_PASSWORD_BYTES &&
      score >= MIN_ACCEPTABLE_PASSWORD_SCORE,
  };
}

export default function Register() {
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [serverFieldErrors, setServerFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const emailIsValid = validateEmail(email);
  const usernameIsValid = validateUsername(username);
  const passwordCheck = useMemo(() => checkPassword(password), [password]);
  const isSubmitDisabled =
    !emailIsValid || !usernameIsValid || !passwordCheck.valid || isSubmitting;

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setServerFieldErrors({});

    if (!emailIsValid || !usernameIsValid || !passwordCheck.valid) {
      setError("Please correct the highlighted registration fields.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_URL}/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ email, username, password }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null) as {
          error?: string;
          fields?: Record<string, unknown>;
        } | null;
        const messages = Object.fromEntries(
          Object.entries(body?.fields ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        );
        setServerFieldErrors(messages);
        setError(Object.keys(messages).length ? "Please review the registration details below." : (body?.error ?? "Unable to register with those details."));
        return;
      }

      navigate("/login");
    } catch {
      setError("Unable to reach the User Service.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <h1>Register</h1>

      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-field">
          <div className="auth-field-heading">
            <label htmlFor="register-email">Email</label>
            {email.length > 0 && !emailIsValid && (
              <span className="auth-tip" role="status">
                Enter an email in the required NUS format.
              </span>
            )}
            {serverFieldErrors.email && <span className="auth-tip" role="alert">{serverFieldErrors.email}</span>}
          </div>
          <input
            id="register-email"
            type="email"
            placeholder="e.g. e1234567@u.nus.edu"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={email.length > 0 && !emailIsValid}
            required
          />
        </div>

        <div className="auth-field">
          <div className="auth-field-heading">
            <label htmlFor="register-username">Username</label>
            {username.length > 0 && !usernameIsValid && (
              <span className="auth-tip" role="status">
                Use 3–30 characters: letters, numbers, underscores.
              </span>
            )}
            {serverFieldErrors.username && <span className="auth-tip" role="alert">{serverFieldErrors.username}</span>}
          </div>
          <input
            id="register-username"
            type="text"
            placeholder="3–30 characters; letters, numbers, underscores"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            aria-invalid={username.length > 0 && !usernameIsValid}
            required
          />
        </div>

        {serverFieldErrors.registration && <p className="auth-tip auth-form-error" role="alert">{serverFieldErrors.registration}</p>}

        <div className="auth-field">
          <div className="auth-field-heading">
            <label htmlFor="register-password">Password</label>
          </div>
          <div
            id="register-password-meter"
            className={`auth-password-meter ${password ? `password-strength-${passwordCheck.score}` : "password-strength-empty"}`}
            role="progressbar"
            aria-label="Password strength"
            aria-valuemin={0}
            aria-valuemax={4}
            aria-valuenow={password ? passwordCheck.score : 0}
            aria-valuetext={
              password
                ? PASSWORD_SCORE_LABELS[passwordCheck.score]
                : "No password entered"
            }
          >
            <span className="auth-password-meter-label" aria-hidden="true">
              {password ? PASSWORD_SCORE_LABELS[passwordCheck.score] : "Password strength"}
            </span>
            <span className="auth-password-meter-track" aria-hidden="true">
              <span
                className="auth-password-meter-fill"
                style={{
                  width: password ? `${(passwordCheck.score / 4) * 100}%` : "0%",
                }}
              />
            </span>
          </div>
          <input
            id="register-password"
            type="password"
            placeholder="10 characters minimum. Need 'Strong' in the bar"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby="register-password-meter"
            aria-invalid={password.length > 0 && !passwordCheck.valid}
            required
          />
        </div>

        {error && <p className="auth-tip auth-form-error" role="alert">{error}</p>}

        <button className="auth-submit" type="submit" disabled={isSubmitDisabled}>
          {isSubmitting ? "Registering..." : "Register"}
        </button>
      </form>

      <p className="auth-alternate-link">
        Already have an account? <Link to="/login">Login</Link> instead!
      </p>
    </main>
  );
}
