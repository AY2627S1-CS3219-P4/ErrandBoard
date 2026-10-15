import assert from "node:assert/strict";
import { test } from "node:test";
import { SignJWT } from "jose";
import { app } from "../dist/app.js";
import { UserCredit } from "../dist/models/UserCredit.js";
import { authorizationStore, decideAuthorization } from "../dist/security/authorization-state.js";

process.env.JWT_SECRET = "credit-balance-test-secret";
const ownId = "507f1f77bcf86cd799439011";
const otherId = "507f1f77bcf86cd799439012";

async function tokenFor(userId = ownId, options = {}) {
  const key = new TextEncoder().encode(options.secret ?? process.env.JWT_SECRET);
  return new SignJWT({ sub: userId, role: "USER", authzVersion: options.version ?? 0 })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(options.expired ? "-1m" : "15m")
    .sign(key);
}

async function startServer() {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(done)),
      });
    });
  });
}

function mockBalance(t, account = { available: 75, reserve: 25 }) {
  return t.mock.method(UserCredit, "findOne", (filter) => {
    assert.equal(filter.userId.toString(), ownId);
    return {
      select(fields) {
        assert.equal(fields, "available reserve -_id");
        return { lean: async () => account };
      },
    };
  });
}

test("GET /credit/me/balance rejects a request without a token", async (t) => {
  const find = t.mock.method(UserCredit, "findOne", () => { throw new Error("must not query DB"); });
  const server = await startServer();
  try {
    const res = await fetch(`${server.url}/credit/me/balance`);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, "AUTHENTICATION_REQUIRED");
    assert.equal(find.mock.callCount(), 0);
  } finally { await server.close(); }
});

test("valid cookie returns only the token owner's two balances", async (t) => {
  t.mock.method(authorizationStore, "check", async () => "allowed");
  const find = mockBalance(t);
  const server = await startServer();
  try {
    const token = await tokenFor();
    const res = await fetch(`${server.url}/credit/me/balance?userId=${otherId}`, {
      headers: { Cookie: `access_token=${token}` },
    });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { available: 75, reserve: 25 });
    assert.equal(find.mock.callCount(), 1);
  } finally { await server.close(); }
});

test("valid Bearer token also works for a trusted API client", async (t) => {
  t.mock.method(authorizationStore, "check", async () => "allowed");
  mockBalance(t);
  const server = await startServer();
  try {
    const res = await fetch(`${server.url}/credit/me/balance`, {
      headers: { Authorization: `Bearer ${await tokenFor()}` },
    });
    assert.equal(res.status, 200);
  } finally { await server.close(); }
});

test("expired and incorrectly signed tokens never reach MongoDB", async (t) => {
  const find = t.mock.method(UserCredit, "findOne", () => { throw new Error("must not query DB"); });
  const server = await startServer();
  try {
    for (const [token, code] of [
      [await tokenFor(ownId, { expired: true }), "ACCESS_TOKEN_EXPIRED"],
      [await tokenFor(ownId, { secret: "wrong-signing-key" }), "INVALID_ACCESS_TOKEN"],
    ]) {
      const res = await fetch(`${server.url}/credit/me/balance`, {
        headers: { Cookie: `access_token=${token}` },
      });
      assert.equal(res.status, 401);
      assert.equal((await res.json()).code, code);
    }
    assert.equal(find.mock.callCount(), 0);
  } finally { await server.close(); }
});

test("revocation, deactivation, and unavailable Redis fail closed", async (t) => {
  const check = t.mock.method(authorizationStore, "check", async () => "revoked");
  const find = t.mock.method(UserCredit, "findOne", () => { throw new Error("must not query DB"); });
  const server = await startServer();
  try {
    const token = await tokenFor();
    for (const [decision, status, code] of [
      ["revoked", 401, "ACCESS_REVOKED"],
      ["inactive", 403, "ACCOUNT_INACTIVE"],
      ["unavailable", 503, "AUTHORIZATION_UNAVAILABLE"],
    ]) {
      check.mock.mockImplementation(async () => decision);
      const res = await fetch(`${server.url}/credit/me/balance`, {
        headers: { Cookie: `access_token=${token}` },
      });
      assert.equal(res.status, status);
      assert.equal((await res.json()).code, code);
    }
    assert.equal(find.mock.callCount(), 0);
  } finally { await server.close(); }
});

test("missing Credit account returns 404 without exposing another account", async (t) => {
  t.mock.method(authorizationStore, "check", async () => "allowed");
  mockBalance(t, null);
  const server = await startServer();
  try {
    const res = await fetch(`${server.url}/credit/me/balance`, {
      headers: { Cookie: `access_token=${await tokenFor()}` },
    });
    assert.equal(res.status, 404);
    assert.equal((await res.json()).code, "CREDIT_ACCOUNT_NOT_FOUND");
  } finally { await server.close(); }
});

test("Redis authorization state must match token role and version", () => {
  const claims = { userId: ownId, role: "USER", authzVersion: 2 };
  const state = { version: 2, role: "USER", active: true, blocked: false };
  assert.equal(decideAuthorization(state, claims), "allowed");
  assert.equal(decideAuthorization({ ...state, version: 3 }, claims), "revoked");
  assert.equal(decideAuthorization({ ...state, role: "ADMIN" }, claims), "revoked");
  assert.equal(decideAuthorization({ ...state, blocked: true }, claims), "revoked");
  assert.equal(decideAuthorization({ ...state, active: false }, claims), "inactive");
  assert.equal(decideAuthorization(null, claims), "unavailable");
});

test("a database failure returns a generic error without leaking account data", async (t) => {
  t.mock.method(authorizationStore, "check", async () => "allowed");
  t.mock.method(UserCredit, "findOne", () => { throw new Error("private database detail"); });
  const originalError = console.error;
  console.error = () => {};
  const server = await startServer();
  try {
    const res = await fetch(`${server.url}/credit/me/balance`, {
      headers: { Cookie: `access_token=${await tokenFor()}` },
    });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.code, "CREDIT_BALANCE_UNAVAILABLE");
    assert.ok(!JSON.stringify(body).includes("private database detail"));
  } finally {
    await server.close();
    console.error = originalError;
  }
});
