import assert from "node:assert/strict";
import { test } from "node:test";
import { validateRegistration } from "../src/validators/registration.validator.js";

const strongPassword = "qf7$Lx2@vB9!Rk3#nP5^wM8";
const exactBcryptBoundaryPassword =
  "7f3a91d8c0b2e465a7f39c1d8b0e2a6c5f4b9d1e7a3c0f8b2d6e1a9c7f5b3d0eA9b2C3d4";

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    email: "e0000000@u.nus.edu",
    username: "Alice_123",
    password: strongPassword,
    ...overrides,
  };
}

test("accepts valid registration data and normalizes the email", () => {
  const result = validateRegistration(
    validInput({ email: "  E0000000@U.NUS.EDU  " }),
  );

  assert.equal(result.valid, true);
  if (result.valid) {
    assert.deepEqual(result.data, {
      email: "e0000000@u.nus.edu",
      username: "Alice_123",
      password: strongPassword,
    });
  }
});

for (const input of [null, undefined, "not an object", 42, []]) {
  test(`rejects a non-object registration body (${String(input)})`, () => {
    const result = validateRegistration(input);

    assert.equal(result.valid, false);
    if (!result.valid) assert.ok(result.errors.body);
  });
}

for (const email of ["", "not-an-email", "e0000000@example.com", "e123@u.nus.edu"]) {
  test(`rejects invalid NUS email: ${JSON.stringify(email)}`, () => {
    const result = validateRegistration(validInput({ email }));

    assert.equal(result.valid, false);
    if (!result.valid) assert.ok(result.errors.email);
  });
}

test("rejects non-string registration fields without throwing", () => {
  const result = validateRegistration(
    validInput({ email: 123, username: null, password: ["password"] }),
  );

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.ok(result.errors.email);
    assert.ok(result.errors.username);
    assert.ok(result.errors.password);
  }
});

for (const username of ["ab", "a".repeat(31), "alice smith", "alice!"]) {
  test(`rejects invalid username: ${JSON.stringify(username)}`, () => {
    const result = validateRegistration(validInput({ username }));

    assert.equal(result.valid, false);
    if (!result.valid) assert.ok(result.errors.username);
  });
}

for (const username of ["abc", "a".repeat(30)]) {
  test(`accepts username boundary: ${username.length} characters`, () => {
    const result = validateRegistration(validInput({ username }));

    assert.equal(result.valid, true);
  });
}

test("rejects passwords shorter than the configured minimum", () => {
  const result = validateRegistration(validInput({ password: "a".repeat(9) }));

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.equal(
      result.errors.password,
      "Password must be at least 10 characters.",
    );
  }
});

test("accepts a password at the 10-character minimum when it reaches the score threshold", () => {
  const minimumLengthStrongPassword = "q7$A1!zP9#";
  assert.equal(Array.from(minimumLengthStrongPassword).length, 10);
  const result = validateRegistration(
    validInput({ password: minimumLengthStrongPassword }),
  );

  assert.equal(result.valid, true);
});

test("rejects a long but guessable password based on its zxcvbn score", () => {
  const result = validateRegistration(
    validInput({ password: "password123!password123!" }),
  );

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.equal(result.errors.password, "Password must be rated strong or better.");
  }
});

test("accepts a very-strong password exactly at bcrypt's 72-byte limit", () => {
  assert.equal(new TextEncoder().encode(exactBcryptBoundaryPassword).length, 72);
  const result = validateRegistration(
    validInput({ password: exactBcryptBoundaryPassword }),
  );

  assert.equal(result.valid, true);
});

test("rejects passwords exceeding bcrypt's byte limit, including multi-byte text", () => {
  const result = validateRegistration(validInput({ password: "é".repeat(37) }));

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.equal(
      result.errors.password,
      "Password must not exceed 72 UTF-8 bytes.",
    );
  }
});
