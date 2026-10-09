import assert from "node:assert/strict";
import { test } from "node:test";
import { Types } from "mongoose";
import { User } from "../src/models/User.js";
import { backfillUserCredits } from "../src/scripts/backfill-user-credits.js";
import { seedUsers } from "../src/scripts/seed-users.js";

test("seeding provisions credits for new and previously seeded users using their persisted IDs", async (t) => {
  process.env.CREDIT_SERVICE_URL = "http://credit-service:3004";
  process.env.CREDIT_INTERNAL_API_KEY = "test-credit-key";
  t.after(() => {
    delete process.env.CREDIT_SERVICE_URL;
    delete process.env.CREDIT_INTERNAL_API_KEY;
  });

  const activeId = new Types.ObjectId();
  const inactiveId = new Types.ObjectId();
  const rows = [
    { email: "e1234567@u.nus.edu", username: "alice", passwordHash: `$2b$12$${"A".repeat(53)}`, accountType: "USER" as const },
    { email: "e2345678@u.nus.edu", username: "bob", passwordHash: `$2b$12$${"B".repeat(53)}`, accountType: "USER" as const, isActive: "false" },
  ];
  const persisted = [
    { _id: activeId, isActive: true },
    { _id: inactiveId, isActive: false },
  ];

  t.mock.method(User, "updateMany", async () => ({}));
  const bulkWrite = t.mock.method(User, "bulkWrite", async () => ({ upsertedCount: 1, matchedCount: 1 }));
  t.mock.method(User, "find", () => ({
    select: () => ({ lean: async () => persisted }),
  }));
  const calls: Array<{ url: string; isActive: boolean }> = [];
  t.mock.method(globalThis, "fetch", async (url: URL | string | Request, options?: RequestInit) => {
    const body = JSON.parse(options?.body as string);
    assert.deepEqual(Object.keys(body), ["isActive"]);
    calls.push({ url: url.toString(), isActive: body.isActive });
    assert.equal((options?.headers as Record<string, string>).Authorization, "Bearer test-credit-key");
    return new Response(null, { status: 204 });
  });

  await seedUsers(rows);

  assert.equal(bulkWrite.mock.callCount(), 1);
  assert.deepEqual(calls, [
    { url: `http://credit-service:3004/credit/accounts/${activeId}`, isActive: true },
    { url: `http://credit-service:3004/credit/accounts/${inactiveId}`, isActive: false },
  ]);
});

test("seeding fails when credit provisioning fails so a rerun can repair it", async (t) => {
  process.env.CREDIT_SERVICE_URL = "http://credit-service:3004";
  process.env.CREDIT_INTERNAL_API_KEY = "test-credit-key";
  t.after(() => {
    delete process.env.CREDIT_SERVICE_URL;
    delete process.env.CREDIT_INTERNAL_API_KEY;
  });
  t.mock.method(User, "updateMany", async () => ({}));
  t.mock.method(User, "bulkWrite", async () => ({ upsertedCount: 0, matchedCount: 1 }));
  t.mock.method(User, "find", () => ({
    select: () => ({ lean: async () => [{ _id: new Types.ObjectId(), isActive: true }] }),
  }));
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));

  await assert.rejects(seedUsers([{ email: "e1234567@u.nus.edu", username: "alice",
    passwordHash: `$2b$12$${"A".repeat(53)}`, accountType: "USER" }]),
  /Credit account service is unavailable/);
});

test("one-time backfill covers non-CSV Users without changing their existing credit balances", async (t) => {
  process.env.CREDIT_SERVICE_URL = "http://credit-service:3004";
  process.env.CREDIT_INTERNAL_API_KEY = "test-credit-key";
  t.after(() => {
    delete process.env.CREDIT_SERVICE_URL;
    delete process.env.CREDIT_INTERNAL_API_KEY;
  });
  const existingId = new Types.ObjectId();
  t.mock.method(User, "find", () => ({
    select: () => ({ lean: () => ({
      cursor: async function* () { yield { _id: existingId, isActive: false }; },
    }) }),
  }));
  const calls: Array<{ url: string; isActive: boolean }> = [];
  t.mock.method(globalThis, "fetch", async (url: URL | string | Request, options?: RequestInit) => {
    calls.push({ url: url.toString(), isActive: JSON.parse(options?.body as string).isActive });
    return new Response(null, { status: 204 });
  });

  assert.equal(await backfillUserCredits(), 1);
  assert.deepEqual(calls, [{
    url: `http://credit-service:3004/credit/accounts/${existingId}`,
    isActive: false,
  }]);
});
