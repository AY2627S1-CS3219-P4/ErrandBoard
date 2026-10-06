import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { decodeJwt, SignJWT } from "jose";
import { createAccessToken, isAccessTokenExpired, verifyAccessToken } from "../src/security/token.js";

// Public test fixture, never a deployment secret. Tests do not load .env.
const testSecret = "unit-test-signing-key-not-for-deployment-123456789";
const userId = "507f1f77bcf86cd799439011";
let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = testSecret;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalSecret;
});

function signTestToken(claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(testSecret));
}

function tamper(token: string, changes: Record<string, unknown>) {
  const [header, payload, signature] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload!, "base64url").toString());
  const changedPayload = Buffer.from(JSON.stringify({ ...claims, ...changes })).toString("base64url");
  return `${header}.${changedPayload}.${signature}`;
}

test("issued JWT verifies the user ID and expires after 15 minutes", async () => {
  const token = await createAccessToken(userId, "USER", 2);
  assert.deepEqual(await verifyAccessToken(token), { userId, role: "USER", authzVersion: 2 });
  // Decode only to inspect claims; verification above authenticates them.
  const payload = decodeJwt(token);
  assert.equal(typeof payload.iat, "number");
  assert.equal(typeof payload.exp, "number");
  assert.equal(payload.exp! - payload.iat!, 15 * 60);
});

test("issued JWT carries the ADMIN role", async () => {
  const token = await createAccessToken(userId, "ADMIN", 4);
  assert.deepEqual(await verifyAccessToken(token), { userId, role: "ADMIN", authzVersion: 4 });
});

test("verification rejects a tampered subject", async () => {
  const token = await createAccessToken(userId, "USER", 0);
  await assert.rejects(verifyAccessToken(tamper(token, { sub: "another-user" })), {
    code: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  });
});

test("verification rejects a role escalated after signing", async () => {
  const token = await createAccessToken(userId, "USER", 0);
  await assert.rejects(verifyAccessToken(tamper(token, { role: "ADMIN" })), {
    code: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  });
});

test("verification rejects a signed token without a role", async () => {
  const token = await signTestToken({ sub: userId });
  await assert.rejects(verifyAccessToken(token), /JWT role is missing or invalid/);
});

test("verification rejects a signed token with an unknown role", async () => {
  const token = await signTestToken({ sub: userId, role: "SUPERUSER" });
  await assert.rejects(verifyAccessToken(token), /JWT role is missing or invalid/);
});

test("verification rejects legacy tokens without an authorization version", async () => {
  const token = await signTestToken({ sub: userId, role: "ADMIN" });
  await assert.rejects(verifyAccessToken(token), /authorization version is missing or invalid/);
});

test("verification rejects a token signed with a different secret", async () => {
  const token = await createAccessToken(userId, "USER", 0);
  process.env.JWT_SECRET = "a-different-unit-test-signing-key-123456789";
  await assert.rejects(verifyAccessToken(token), {
    code: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  });
});

test("verification rejects an expired token without waiting for real time", async () => {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(new TextEncoder().encode(testSecret));

  let expirationError: unknown;
  try {
    await verifyAccessToken(token);
  } catch (error) {
    expirationError = error;
  }
  assert.equal(isAccessTokenExpired(expirationError), true);
});

test("malformed and invalid-signature tokens are not classified as expiry", async () => {
  await assert.rejects(verifyAccessToken("not-a-jwt"), (error) => {
    assert.equal(isAccessTokenExpired(error), false);
    return true;
  });
});

test("verification rejects malformed and unsigned tokens", async () => {
  await assert.rejects(verifyAccessToken("not-a-jwt"));
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: userId })).toString("base64url");
  await assert.rejects(verifyAccessToken(`${header}.${payload}.`));
});

test("verification rejects a signed token without a subject", async () => {
  const token = await signTestToken({ role: "USER" });
  await assert.rejects(verifyAccessToken(token), /JWT subject is missing/);
});

test("signing and verification fail clearly when JWT_SECRET is missing", async () => {
  const token = await createAccessToken(userId, "USER", 0);
  delete process.env.JWT_SECRET;
  await assert.rejects(createAccessToken(userId, "USER", 0), /JWT_SECRET is required/);
  await assert.rejects(verifyAccessToken(token), /JWT_SECRET is required/);
});
