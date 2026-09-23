import assert from "node:assert/strict";
import { before, test } from "node:test";
import bcrypt from "bcryptjs";
import { hashPassword, verifyPassword } from "../src/security/password.js";

const password = "Campus errand password!";
let storedHash: string;

before(async () => {
  storedHash = await hashPassword(password);
});

test("hashing uses independent salts and the configured work factor", async () => {
  const secondHash = await hashPassword(password);

  assert.notEqual(storedHash, password);
  assert.notEqual(secondHash, storedHash);
  assert.notEqual(bcrypt.getSalt(secondHash), bcrypt.getSalt(storedHash));
  assert.equal(bcrypt.getRounds(storedHash), 12);
  assert.equal(await verifyPassword(password, storedHash), true);
  assert.equal(await verifyPassword(password, secondHash), true);
});

test("verification rejects a wrong, differently cased, or empty password", async () => {
  for (const input of ["incorrect", password.toLowerCase(), ""]) {
    assert.equal(await verifyPassword(input, storedHash), false);
  }
});

test("verification does not accept a plaintext value as a stored hash", async () => {
  assert.equal(await verifyPassword(password, password), false);
});

test("a Unicode password at bcrypt's 72-byte boundary verifies without trimming", async () => {
  const boundaryPassword = "é".repeat(35) + "  ";
  assert.equal(Buffer.byteLength(boundaryPassword, "utf8"), 72);
  const hash = await hashPassword(boundaryPassword);

  assert.equal(await verifyPassword(boundaryPassword, hash), true);
  assert.equal(await verifyPassword(boundaryPassword.trim(), hash), false);
});
