import assert from "node:assert/strict";
import { test } from "node:test";
import type { Server } from "node:http";
import { SignJWT } from "jose";
import { app } from "../src/app.js";
import { Supplier } from "../src/models/Supplier.js";
import { type AccountType } from "../src/types/auth.types.js";
import { authorizationStore } from "../src/security/authorization-state.js";

process.env.JWT_SECRET ??= "test-secret-do-not-use-in-prod";

async function startServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const server: Server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        baseUrl: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

async function signToken(userId: string, role: AccountType): Promise<string> {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  return new SignJWT({ sub: userId, role, authzVersion: 0 })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime("15m")
    .sign(secret);
}

async function signExpiredToken(userId: string, role: AccountType): Promise<string> {
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  return new SignJWT({ sub: userId, role, authzVersion: 0 })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(secret);
}

test("POST /suppliers rejects a request with no session (requireAuth)", async () => {
  const server = await startServer();

  try {
    const res = await fetch(`${server.baseUrl}/suppliers`, { method: "POST" });
    assert.equal(res.status, 401);
  } finally {
    await server.close();
  }
});

test("POST /suppliers rejects a non-admin session (requireAdmin, NFR4.1)", async (t) => {
  t.mock.method(authorizationStore, "check", async () => "allowed" as const);
  const server = await startServer();

  try {
    const token = await signToken("test_id", "USER");
    const res = await fetch(`${server.baseUrl}/suppliers`, {
      method: "POST",
      headers: { Cookie: `access_token=${token}` },
    });
    assert.equal(res.status, 403);
  } finally {
    await server.close();
  }
});

test("POST /suppliers identifies an expired access token for frontend refresh", async () => {
  const server = await startServer();

  try {
    const token = await signExpiredToken("test_id", "ADMIN");
    const res = await fetch(`${server.baseUrl}/suppliers`, {
      method: "POST",
      headers: { Cookie: `access_token=${token}` },
    });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), {
      code: "ACCESS_TOKEN_EXPIRED",
      error: "Access token expired",
    });
  } finally {
    await server.close();
  }
});

test("public supplier listing reports an expired optional token instead of silently downgrading an admin", async () => {
  const server = await startServer();

  try {
    const token = await signExpiredToken("test_id", "ADMIN");
    const res = await fetch(`${server.baseUrl}/suppliers?showInactive=true`, {
      headers: { Cookie: `access_token=${token}` },
    });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), {
      code: "ACCESS_TOKEN_EXPIRED",
      error: "Access token expired",
    });
  } finally {
    await server.close();
  }
});

test("POST /suppliers reaches the controller for an admin session", async (t) => {
  t.mock.method(authorizationStore, "check", async () => "allowed" as const);
  // Only the DB call is faked — auth, routing, and the controller all run
  // for real. This is what confirms the middleware chain is wired in the
  // right order (requireAuth -> requireAdmin -> create), not just that
  // each piece works in isolation.
  t.mock.method(Supplier, "create", async () => ({ _id: "1", name: "Test" }));

  const server = await startServer();

  try {
    const token = await signToken("test_id", "ADMIN");
    const res = await fetch(`${server.baseUrl}/suppliers`, {
      method: "POST",
      headers: {
        Cookie: `access_token=${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "Test",
        category: "FOOD_BEVERAGE",
        building: "COM3",
      }),
    });
    assert.equal(res.status, 201);
  } finally {
    await server.close();
  }
});

test("demoted admin's still-signed token is rejected before supplier mutation", async (t) => {
  t.mock.method(authorizationStore, "check", async () => "revoked" as const);
  const write = t.mock.method(Supplier, "create", async () => { throw new Error("must not create supplier"); });
  const server = await startServer();
  try {
    const token = await signToken("test_id", "ADMIN");
    const res = await fetch(`${server.baseUrl}/suppliers`, {
      method: "POST", headers: { Cookie: `access_token=${token}` },
    });
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, "ACCESS_REVOKED");
    assert.equal(write.mock.callCount(), 0);
  } finally { await server.close(); }
});

test("Redis outage denies admin supplier mutation", async (t) => {
  t.mock.method(authorizationStore, "check", async () => "unavailable" as const);
  const server = await startServer();
  try {
    const token = await signToken("test_id", "ADMIN");
    const res = await fetch(`${server.baseUrl}/suppliers`, {
      method: "POST", headers: { Cookie: `access_token=${token}` },
    });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, "AUTHORIZATION_UNAVAILABLE");
  } finally { await server.close(); }
});

test("GET /suppliers requires no auth at all (F7 is a public listing)", async (t) => {
  t.mock.method(Supplier, "find", () => ({ sort: () => [] }));

  const server = await startServer();

  try {
    const res = await fetch(`${server.baseUrl}/suppliers`);
    assert.equal(res.status, 200);
  } finally {
    await server.close();
  }
});

test("DELETE /suppliers/:id requires admin, same as create/update", async () => {
  const server = await startServer();

  try {
    const res = await fetch(`${server.baseUrl}/suppliers/507f1f77bcf86cd799439011`, {
      method: "DELETE",
    });
    assert.equal(res.status, 401);
  } finally {
    await server.close();
  }
});

test("unknown routes fall through to Express's default 404", async () => {
  const server = await startServer();

  try {
    const res = await fetch(`${server.baseUrl}/this-route-does-not-exist`);
    assert.equal(res.status, 404);
  } finally {
    await server.close();
  }
});
