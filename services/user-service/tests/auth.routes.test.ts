import assert from "node:assert/strict";
import { test } from "node:test";
import type { Server } from "node:http";
import { SignJWT } from "jose";
import { app } from "../src/app.js";
import { authorizationStore } from "../src/security/authorization-state.js";

const signingSecret = "auth-route-test-secret-not-for-deployment-123456";

async function startServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server: Server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

test("account administration returns the stable expiry code for expired access JWTs", async (t) => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = signingSecret;
  t.after(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });

  const token = await new SignJWT({ sub: "507f1f77bcf86cd799439011", role: "SUPERADMIN" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(new TextEncoder().encode(signingSecret));
  const server = await startServer();

  try {
    const response = await fetch(`${server.baseUrl}/accounts`, {
      headers: { Cookie: `access_token=${token}` },
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      code: "ACCESS_TOKEN_EXPIRED",
      error: "Access token expired",
    });
  } finally {
    await server.close();
  }
});

test("POST /auth/refresh is registered and rejects a missing refresh cookie", async () => {
  const server = await startServer();

  try {
    const response = await fetch(`${server.baseUrl}/auth/refresh`, { method: "POST" });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      code: "REFRESH_SESSION_INVALID",
      error: "Your session has expired. Please log in again.",
    });
  } finally {
    await server.close();
  }
});

test("a demoted superadmin loses account-management access with an unexpired token", async (t) => {
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = signingSecret;
  t.after(() => {
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
  });
  t.mock.method(authorizationStore, "read", async () => ({ version: 1, role: "ADMIN", active: true, blocked: false }));
  const token = await new SignJWT({ sub: "507f1f77bcf86cd799439011", role: "SUPERADMIN", authzVersion: 0 })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(signingSecret));
  const server = await startServer();
  try {
    const response = await fetch(`${server.baseUrl}/accounts`, { headers: { Cookie: `access_token=${token}` } });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, "ACCESS_REVOKED");
  } finally { await server.close(); }
});
