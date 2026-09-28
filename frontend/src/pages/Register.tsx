import { useMemo, useState, type SubmitEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import * as common from "@zxcvbn-ts/language-common";
import * as english from "@zxcvbn-ts/language-en";

const API_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

const EMAIL_REGEX: RegExp = /^e\d{7}@u\.nus\.edu$/;
const USER_REGEX: RegExp = /^[a-zA-Z0-9_]{3,30}$/;

// Keep these policy thresholds alongside the registration form.
const MIN_PASSWORD_CHARACTERS = 10;
const MAX_PASSWORD_BYTES = 72; // bcrypt's input boundary
const MIN_ACCEPTABLE_PASSWORD_SCORE = 3; // zxcvbn-ts score range: 0–4
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
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Derive validity from the current values instead of keeping separate state
  // that can lag behind a just-typed character.
  const emailIsValid = validateEmail(email);
  const usernameIsValid = validateUsername(username);
  const passwordCheck = useMemo(() => checkPassword(password), [password]);
  const isSubmitDisabled =
    !emailIsValid || !usernameIsValid || !passwordCheck.valid || isSubmitting;

  async function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

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
        setError("Unable to register with those details.");
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
    <main>
      <h1>Register</h1>

      <form onSubmit={handleSubmit}>
        <label>
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={email.length > 0 && !emailIsValid}
            required
          />
        </label>
        {email.length > 0 && !emailIsValid && (
          <p role="status">Enter an email in the required NUS format.</p>
        )}

        <label>
          Username
          <input
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            aria-invalid={username.length > 0 && !usernameIsValid}
            required
          />
        </label>
        {username.length > 0 && !usernameIsValid && (
          <p role="status">
            Username must be 3–30 characters and use only letters, numbers, or
            underscores.
          </p>
        )}

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-describedby={password ? "password-strength-help" : undefined}
            aria-invalid={password.length > 0 && !passwordCheck.valid}
            required
          />
        </label>
        {password && (
          <div id="password-strength-help">
            <label htmlFor="password-strength">
              Password strength: {PASSWORD_SCORE_LABELS[passwordCheck.score]}
            </label>
            <progress
              id="password-strength"
              max={4}
              value={passwordCheck.score}
              aria-label={`Password strength: ${PASSWORD_SCORE_LABELS[passwordCheck.score]}`}
            >
              {passwordCheck.score}/4
            </progress>
            <p>
              Use at least {MIN_PASSWORD_CHARACTERS} characters and no more
              than {MAX_PASSWORD_BYTES} UTF-8 bytes. Current length:{" "}
              {passwordCheck.characterLength} characters, {passwordCheck.byteLength} bytes.
            </p>
          </div>
        )}

        {error && <p role="alert">{error}</p>}

        <button type="submit" disabled={isSubmitDisabled}>
          {isSubmitting ? "Registering..." : "Register"}
        </button>
      </form>

      <p>
        Already have an account? <Link to="/login">Login</Link> instead!
      </p>
    </main>
  );
}
