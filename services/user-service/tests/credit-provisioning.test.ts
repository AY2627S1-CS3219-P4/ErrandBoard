import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { Types } from "mongoose";
import { User } from "../src/models/User.js";
import {
  initialCreditRetryAt,
  nextCreditRetryDelay,
  retryOneCreditAccount,
} from "../src/services/credit-provisioning.service.js";

function creditEnvironment(t: TestContext) {
  const oldUrl = process.env.CREDIT_SERVICE_URL;
  const oldKey = process.env.CREDIT_INTERNAL_API_KEY;
  process.env.CREDIT_SERVICE_URL = "http://credit-service:3004";
  process.env.CREDIT_INTERNAL_API_KEY = "test-credit-key";
  t.after(() => {
    if (oldUrl === undefined) delete process.env.CREDIT_SERVICE_URL;
    else process.env.CREDIT_SERVICE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.CREDIT_INTERNAL_API_KEY;
    else process.env.CREDIT_INTERNAL_API_KEY = oldKey;
  });
}

test("credit retry delay doubles but is capped at five minutes", () => {
  assert.equal(nextCreditRetryDelay(1), 5_000);
  assert.equal(nextCreditRetryDelay(2), 10_000);
  assert.equal(nextCreditRetryDelay(7), 300_000);
  assert.equal(nextCreditRetryDelay(100), 300_000);
  const now = new Date();
  assert.equal(initialCreditRetryAt(now).getTime(), now.getTime() + 5_000);
});

test("worker claims only a due, unleased pending user and clears pending after provisioning", async (t) => {
  creditEnvironment(t);
  const userId = new Types.ObjectId();
  const now = new Date();
  let claim: Record<string, unknown> | undefined;
  t.mock.method(User, "findOneAndUpdate", async (query: Record<string, unknown>, update: Record<string, unknown>) => {
    claim = { query, update };
    return { _id: userId, isActive: false, creditSetupAttempts: 2 };
  });
  const writes: Array<{ query: Record<string, unknown>; update: Record<string, unknown> }> = [];
  t.mock.method(User, "updateOne", async (query: Record<string, unknown>, update: Record<string, unknown>) => {
    writes.push({ query, update });
    return { matchedCount: 1 };
  });
  const call = t.mock.method(globalThis, "fetch", async (url: URL | string | Request, options?: RequestInit) => {
    assert.equal(url.toString(), `http://credit-service:3004/credit/accounts/${userId}`);
    assert.deepEqual(JSON.parse(options?.body as string), { isActive: false });
    return new Response(null, { status: 204 });
  });

  assert.equal(await retryOneCreditAccount(now), true);
  assert.equal(call.mock.callCount(), 1);
  assert.equal((claim?.query as { creditSetupPending: boolean }).creditSetupPending, true);
  assert.equal(((claim?.query as { creditSetupNextRetryAt: { $lte: Date } }).creditSetupNextRetryAt).$lte, now);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].query._id, userId.toString());
  assert.equal(writes[0].query.creditSetupLeaseId, (claim?.update as { $set: { creditSetupLeaseId: string } }).$set.creditSetupLeaseId);
  assert.equal((writes[0].update.$set as { creditSetupPending: boolean }).creditSetupPending, false);
});

test("lost provisioning response leaves a durable retry; a later success clears it", async (t) => {
  creditEnvironment(t);
  const userId = new Types.ObjectId();
  let attempts = 0;
  t.mock.method(User, "findOneAndUpdate", async () => ({
    _id: userId, isActive: true, creditSetupAttempts: attempts,
  }));
  const writes: Record<string, unknown>[] = [];
  t.mock.method(User, "updateOne", async (_query: unknown, update: Record<string, unknown>) => {
    writes.push(update);
    return { matchedCount: 1 };
  });
  const call = t.mock.method(globalThis, "fetch", async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("response lost after Credit committed");
    return new Response(null, { status: 204 });
  });

  assert.equal(await retryOneCreditAccount(), true);
  assert.equal((writes[0].$set as { creditSetupAttempts: number }).creditSetupAttempts, 1);
  assert.equal(await retryOneCreditAccount(), true);
  assert.equal((writes[1].$set as { creditSetupPending: boolean }).creditSetupPending, false);
  assert.equal(call.mock.callCount(), 2);
});

test("worker leaves the database untouched when no retry is due", async (t) => {
  t.mock.method(User, "findOneAndUpdate", async () => null);
  const writes = t.mock.method(User, "updateOne", async () => ({}));
  assert.equal(await retryOneCreditAccount(), false);
  assert.equal(writes.mock.callCount(), 0);
});
