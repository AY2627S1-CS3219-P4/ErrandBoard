import assert from "node:assert/strict";
import { test } from "node:test";
import { SignJWT } from "jose";
import { app } from "../dist/app.js";
import { UserCredit } from "../dist/models/UserCredit.js";
import { TransactionLog } from "../dist/models/TransactionLog.js";
import { authorizationStore } from "../dist/security/authorization-state.js";

process.env.JWT_SECRET = "credit-stats-test-secret";
const adminId = "507f1f77bcf86cd799439011";
const userId = "507f1f77bcf86cd799439012";

async function tokenFor(role, sub) {
  const key = new TextEncoder().encode(process.env.JWT_SECRET);
  return new SignJWT({ sub, role, authzVersion: 0 })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime("15m")
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

test("GET /credit/stats rejects a request without a token", async (t) => {
  const aggregate = t.mock.method(UserCredit, "aggregate", () => { throw new Error("must not query DB"); });
  const server = await startServer();
  try {
    const res = await fetch(`${server.url}/credit/stats`);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).code, "AUTHENTICATION_REQUIRED");
    assert.equal(aggregate.mock.callCount(), 0);
  } finally { await server.close(); }
});

test("GET /credit/stats forbids a non-admin user", async (t) => {
  t.mock.method(authorizationStore, "check", async () => "allowed");
  const balances = t.mock.method(UserCredit, "aggregate", () => { throw new Error("must not query DB"); });
  const ledger = t.mock.method(TransactionLog, "aggregate", () => { throw new Error("must not query DB"); });
  const server = await startServer();
  try {
    const token = await tokenFor("USER", userId);
    const res = await fetch(`${server.url}/credit/stats`, { headers: { Cookie: `access_token=${token}` } });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, "FORBIDDEN");
    assert.equal(balances.mock.callCount(), 0);
    assert.equal(ledger.mock.callCount(), 0);
  } finally { await server.close(); }
});

// UserCredit.aggregate is called twice: a $group for the totals and a $bucket for the
// histogram. Route by pipeline shape so each call gets the right canned result.
function mockUserCreditAggregate(t, groupRows, bucketRows) {
  t.mock.method(UserCredit, "aggregate", async (pipeline) => {
    const isBucket = pipeline.some((stage) => "$bucket" in stage);
    return isBucket ? bucketRows : groupRows;
  });
}

test("GET /credit/stats returns balances, accounts, movement, and the distribution for an admin", async (t) => {
  t.mock.method(authorizationStore, "check", async () => "allowed");
  mockUserCreditAggregate(
    t,
    [{ available: 900, reserve: 100, accounts: 12, activeAccounts: 11 }],
    // $bucket keys are the lower boundary of each band
    [
      { _id: 0, count: 1 },     // "0"
      { _id: 50, count: 2 },    // "50–99"
      { _id: 100, count: 8 },   // "100"
      { _id: 150, count: 1 },   // "150–199"
    ],
  );
  t.mock.method(TransactionLog, "aggregate", async () => [
    { _id: "TRANSFER", amount: 4210 },
    { _id: "REFUND", amount: 380 },
    { _id: "RESERVE", amount: 5000 }, // present in the ledger but not surfaced
  ]);
  const server = await startServer();
  try {
    const token = await tokenFor("ADMIN", adminId);
    const res = await fetch(`${server.url}/credit/stats`, { headers: { Cookie: `access_token=${token}` } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      stats: {
        totalCredits: 1000,
        available: 900,
        reserve: 100,
        accounts: 12,
        activeAccounts: 11,
        transferred: 4210,
        refunded: 380,
        availableDistribution: [
          { label: "0", count: 1 },
          { label: "1–49", count: 0 },
          { label: "50–99", count: 2 },
          { label: "100", count: 8 },
          { label: "101–149", count: 0 },
          { label: "150–199", count: 1 },
          { label: "200+", count: 0 },
        ],
      },
    });
  } finally { await server.close(); }
});

test("GET /credit/stats returns zeros when there are no credit accounts or transactions", async (t) => {
  t.mock.method(authorizationStore, "check", async () => "allowed");
  t.mock.method(UserCredit, "aggregate", async () => []);
  t.mock.method(TransactionLog, "aggregate", async () => []);
  const server = await startServer();
  try {
    const token = await tokenFor("SUPERADMIN", adminId);
    const res = await fetch(`${server.url}/credit/stats`, { headers: { Cookie: `access_token=${token}` } });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      stats: {
        totalCredits: 0,
        available: 0,
        reserve: 0,
        accounts: 0,
        activeAccounts: 0,
        transferred: 0,
        refunded: 0,
        availableDistribution: [
          { label: "0", count: 0 },
          { label: "1–49", count: 0 },
          { label: "50–99", count: 0 },
          { label: "100", count: 0 },
          { label: "101–149", count: 0 },
          { label: "150–199", count: 0 },
          { label: "200+", count: 0 },
        ],
      },
    });
  } finally { await server.close(); }
});
