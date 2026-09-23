import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { decodeJwt, SignJWT } from "jose";
import { createAccessToken, verifyAccessToken } from "../src/security/token.js";

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

test("issued JWT verifies the user ID and expires after 15 minutes", async () => {
  const token = await createAccessToken(userId);
  assert.equal(await verifyAccessToken(token), userId);
  // Decode only to inspect claims; verification above authenticates them.
  const payload = decodeJwt(token);
  assert.equal(typeof payload.iat, "number");
  assert.equal(typeof payload.exp, "number");
  assert.equal(payload.exp! - payload.iat!, 15 * 60);
});

test("verification rejects a tampered subject", async () => {
  const token = await createAccessToken(userId);
  const [header, payload, signature] = token.split(".");
  const claims = JSON.parse(Buffer.from(payload!, "base64url").toString());
  claims.sub = "another-user";
  const changedPayload = Buffer.from(JSON.stringify(claims)).toString("base64url");

  await assert.rejects(verifyAccessToken(`${header}.${changedPayload}.${signature}`), {
    code: "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  });
});

test("verification rejects a token signed with a different secret", async () => {
  const token = await createAccessToken(userId);
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

  await assert.rejects(verifyAccessToken(token), { code: "ERR_JWT_EXPIRED" });
});

test("verification rejects malformed and unsigned tokens", async () => {
  await assert.rejects(verifyAccessToken("not-a-jwt"));
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: userId })).toString("base64url");
  await assert.rejects(verifyAccessToken(`${header}.${payload}.`));
});

test("verification rejects a signed token without a subject", async () => {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(testSecret));
  await assert.rejects(verifyAccessToken(token), /JWT subject is missing/);
});

test("signing and verification fail clearly when JWT_SECRET is missing", async () => {
  const token = await createAccessToken(userId);
  delete process.env.JWT_SECRET;
  await assert.rejects(createAccessToken(userId), /JWT_SECRET is required/);
  await assert.rejects(verifyAccessToken(token), /JWT_SECRET is required/);
});
