import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidRegistrationEmail, normalizeRegistrationEmail } from "../src/auth/registration-email.ts";

test("registration accepts uppercase NUS email and submits lowercase", () => {
  assert.equal(isValidRegistrationEmail("E1234567@U.NUS.EDU"), true);
  assert.equal(normalizeRegistrationEmail(" E1234567@U.NUS.EDU "), "e1234567@u.nus.edu");
  assert.equal(isValidRegistrationEmail(" E1234567@U.NUS.EDU "), true);
  assert.equal(isValidRegistrationEmail("E1234567@EXAMPLE.COM"), false);
});
