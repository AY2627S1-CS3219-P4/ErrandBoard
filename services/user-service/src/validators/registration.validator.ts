import { ZxcvbnFactory } from "@zxcvbn-ts/core";
import * as common from "@zxcvbn-ts/language-common";
import * as english from "@zxcvbn-ts/language-en";

const EMAIL_REGEX = /^e\d{7}@u\.nus\.edu$/;
const USER_REGEX = /^[a-zA-Z0-9_]{3,30}$/;
const MIN_PASSWORD_CHARACTERS = 10;
const MAX_PASSWORD_BYTES = 72;
const MIN_ACCEPTABLE_PASSWORD_SCORE = 3;

const passwordEstimator = new ZxcvbnFactory({
  translations: english.translations,
  graphs: common.adjacencyGraphs,
  dictionary: {
    ...common.dictionary,
    ...english.dictionary,
  },
});

type RegistrationData = {
  email: string;
  username: string;
  password: string;
};

type RegistrationField = keyof RegistrationData;

export type RegistrationValidation =
  | { valid: true; data: RegistrationData }
  | {
      valid: false;
      errors: Partial<Record<RegistrationField | "body", string>>;
    };

export function validatePassword(value: string): string | undefined {
  if (value.length > MAX_PASSWORD_BYTES) {
    return `Password must not exceed ${MAX_PASSWORD_BYTES} UTF-8 bytes.`;
  }

  const characterLength = Array.from(value).length;
  const byteLength = new TextEncoder().encode(value).length;

  if (characterLength < MIN_PASSWORD_CHARACTERS) {
    return `Password must be at least ${MIN_PASSWORD_CHARACTERS} characters.`;
  }

  if (byteLength > MAX_PASSWORD_BYTES) {
    return `Password must not exceed ${MAX_PASSWORD_BYTES} UTF-8 bytes.`;
  }

  if (passwordEstimator.check(value).score < MIN_ACCEPTABLE_PASSWORD_SCORE) {
    return "Password must be rated strong or better.";
  }
}

export function validUsername(value: unknown): value is string {
  return typeof value === "string" && USER_REGEX.test(value);
}

// Current credentials need type/size checks, not the new-password strength policy.
export function validCredential(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_PASSWORD_BYTES && Buffer.byteLength(value, "utf8") <= MAX_PASSWORD_BYTES;
}

export function validateRegistration(input: unknown): RegistrationValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      valid: false,
      errors: { body: "Expected a JSON object containing registration fields." },
    };
  }

  const body = input as Record<string, unknown>;
  const errors: Partial<Record<RegistrationField, string>> = {};
  let email: string | undefined;
  let username: string | undefined;
  let password: string | undefined;

  if (typeof body.email !== "string" || body.email.trim() === "") {
    errors.email = "Email is required and must be text.";
  } else {
    email = body.email.trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) {
      errors.email = "Email must use the NUS student email format.";
    }
  }

  if (typeof body.username !== "string") {
    errors.username = "Username is required and must be text.";
  } else if (!USER_REGEX.test(body.username)) {
    errors.username = "Username must be 3–30 letters, numbers, or underscores.";
  } else {
    username = body.username;
  }

  if (typeof body.password !== "string") {
    errors.password = "Password is required and must be text.";
  } else {
    password = body.password;
    const passwordError = validatePassword(password);
    if (passwordError) errors.password = passwordError;
  }

  if (Object.keys(errors).length > 0 || !email || !username || password === undefined) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: { email, username, password },
  };
}
