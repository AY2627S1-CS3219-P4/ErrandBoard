import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import mongoose, { Types } from "mongoose";
import { Errand } from "../src/models/Errand.js";
import { OrderCreation } from "../src/models/OrderCreation.js";
import {
  nextCreationRetryDelay,
  reconcileOnePendingCreation,
  recordOrderCreation,
  saveErrandAndCompleteCreation,
} from "../src/services/order-creation.service.js";
import { CreditRecoveryRequiredError } from "../src/errors/order.errors.js";

const orderId = new Types.ObjectId("507f1f77bcf86cd799439011");
const requesterId = "507f1f77bcf86cd799439012";
const creation = { _id: orderId, requesterId, amount: 20, state: "PENDING", retryAttempts: 0 };

function setCreditConfig(t: TestContext) {
  const oldKey = process.env.ORDER_CREDIT_API_KEY;
  const oldUrl = process.env.CREDIT_SERVICE_URL;
  process.env.ORDER_CREDIT_API_KEY = "test-order-key";
  process.env.CREDIT_SERVICE_URL = "http://credit-service:3004";
  t.after(() => {
    if (oldKey === undefined) delete process.env.ORDER_CREDIT_API_KEY;
    else process.env.ORDER_CREDIT_API_KEY = oldKey;
    if (oldUrl === undefined) delete process.env.CREDIT_SERVICE_URL;
    else process.env.CREDIT_SERVICE_URL = oldUrl;
  });
}

test("creation intent is durable and delayed beyond the in-flight request", async (t) => {
  let saved: Record<string, unknown> | undefined;
  t.mock.method(OrderCreation, "create", (async (value: Record<string, unknown>) => {
    saved = value;
    return value;
  }) as never);
  const before = Date.now();
  await recordOrderCreation({ orderId: orderId.toString(), requesterId, amount: 20 });
  assert.equal(saved?._id?.toString(), orderId.toString());
  assert.equal(saved?.state, "PENDING");
  assert.equal(saved?.requesterId, requesterId);
  assert.equal(saved?.amount, 20);
  assert.ok((saved?.retryAt as Date).getTime() >= before + 60_000);
});

test("Errand insertion and intent completion use one MongoDB transaction", async (t) => {
  const session = {
    withTransaction: async (work: () => Promise<void>) => work(),
    endSession: async () => {},
  };
  t.mock.method(mongoose, "startSession", (async () => session) as never);
  const updates: Array<{ filter: Record<string, unknown>; options: Record<string, unknown> }> = [];
  t.mock.method(OrderCreation, "updateOne", (async (filter: Record<string, unknown>, _update: unknown, options: Record<string, unknown>) => {
    updates.push({ filter, options });
    return { matchedCount: 1 };
  }) as never);
  const create = t.mock.method(Errand, "create", (async (docs: unknown[], options: Record<string, unknown>) => {
    assert.equal(options.session, session);
    return docs;
  }) as never);
  const data = {
    _id: orderId, requesterId,
    supplier: { supplierId: "s1", name: "Shop", building: "COM1", address: "1 Computing Drive" },
    dropoff: "COM1", description: "Lunch", credit: 20,
    status: "OPEN" as const, expiresAt: new Date(Date.now() + 60_000),
  };

  const result = await saveErrandAndCompleteCreation(data);
  assert.equal(result._id, orderId);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].options.session, session);
  assert.deepEqual(updates[0].filter.leaseId, { $exists: false });
  assert.equal(create.mock.callCount(), 1);
});

test("a recovery worker claim prevents a late Errand transaction from committing", async (t) => {
  t.mock.method(mongoose, "startSession", (async () => ({
    withTransaction: async (work: () => Promise<void>) => work(),
    endSession: async () => {},
  })) as never);
  t.mock.method(OrderCreation, "updateOne", (async () => ({ matchedCount: 0 })) as never);
  const create = t.mock.method(Errand, "create", (async () => { throw new Error("must not insert"); }) as never);
  await assert.rejects(saveErrandAndCompleteCreation({
    _id: orderId, requesterId,
    supplier: { supplierId: "s1", name: "Shop", building: "COM1", address: "1 Computing Drive" },
    dropoff: "COM1", description: "Lunch", credit: 20,
    status: "OPEN", expiresAt: new Date(Date.now() + 60_000),
  }), CreditRecoveryRequiredError);
  assert.equal(create.mock.callCount(), 0);
});

test("recovery lease and retry delays are bounded", () => {
  assert.equal(nextCreationRetryDelay(1), 5_000);
  assert.equal(nextCreationRetryDelay(2), 10_000);
  assert.equal(nextCreationRetryDelay(100), 300_000);
});

test("a reserved credit with no Errand is released and marked compensated", async (t) => {
  setCreditConfig(t);
  let claim: Record<string, unknown> | undefined;
  t.mock.method(OrderCreation, "findOneAndUpdate", (async (query: Record<string, unknown>, update: Record<string, unknown>) => {
    claim = { query, update };
    return creation;
  }) as never);
  t.mock.method(Errand, "findById", (async () => null) as never);
  let finalState = "";
  t.mock.method(OrderCreation, "updateOne", (async (_filter: unknown, update: { $set: { state?: string } }) => {
    finalState = update.$set.state ?? "";
    return { matchedCount: 1 };
  }) as never);
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", (async (url: URL | string) => {
    paths.push(url.toString());
    if (url.toString().endsWith("/release")) return Response.json({ applied: true, state: "REFUNDED" });
    return Response.json({ state: "RESERVED", requesterId, amount: 20 });
  }) as never);

  assert.equal(await reconcileOnePendingCreation(), true);
  assert.equal(finalState, "COMPENSATED");
  assert.equal(paths.length, 2);
  assert.ok(paths[1].endsWith("/release"));
  assert.equal((claim?.query as { state: string }).state, "PENDING");
  assert.ok((claim?.update as { $set: { leaseId: string } }).$set.leaseId);
});

test("a committed Errand is kept rather than refunded after a lost write response", async (t) => {
  setCreditConfig(t);
  t.mock.method(OrderCreation, "findOneAndUpdate", (async () => creation) as never);
  t.mock.method(Errand, "findById", (async () => ({ _id: orderId, status: "OPEN" })) as never);
  let finalState = "";
  t.mock.method(OrderCreation, "updateOne", (async (_filter: unknown, update: { $set: { state?: string } }) => {
    finalState = update.$set.state ?? "";
    return { matchedCount: 1 };
  }) as never);
  const call = t.mock.method(globalThis, "fetch", (async () =>
    Response.json({ state: "RESERVED", requesterId, amount: 20 })) as never);

  assert.equal(await reconcileOnePendingCreation(), true);
  assert.equal(finalState, "COMPLETED");
  assert.equal(call.mock.callCount(), 1, "no release request is made");
});

test("an active Errand with refunded Credit is isolated rather than silently accepted", async (t) => {
  setCreditConfig(t);
  t.mock.method(OrderCreation, "findOneAndUpdate", (async () => creation) as never);
  t.mock.method(Errand, "findById", (async () => ({ _id: orderId, status: "OPEN" })) as never);
  let finalState = "";
  t.mock.method(OrderCreation, "updateOne", (async (_filter: unknown, update: { $set: { state?: string } }) => {
    finalState = update.$set.state ?? "";
    return { matchedCount: 1 };
  }) as never);
  const call = t.mock.method(globalThis, "fetch", (async () =>
    Response.json({ state: "REFUNDED", requesterId, amount: 20 })) as never);
  t.mock.method(console, "error", () => {});

  assert.equal(await reconcileOnePendingCreation(), true);
  assert.equal(finalState, "RECONCILE");
  assert.equal(call.mock.callCount(), 1);
});

test("a Credit outage keeps recovery pending with capped backoff", async (t) => {
  setCreditConfig(t);
  t.mock.method(OrderCreation, "findOneAndUpdate", (async () => creation) as never);
  t.mock.method(Errand, "findById", (async () => null) as never);
  let retry: Record<string, unknown> | undefined;
  t.mock.method(OrderCreation, "updateOne", (async (_filter: unknown, update: Record<string, unknown>) => {
    retry = update;
    return { matchedCount: 1 };
  }) as never);
  t.mock.method(globalThis, "fetch", (async () => Response.json({ error: "down" }, { status: 503 })) as never);
  t.mock.method(console, "warn", () => {});

  assert.equal(await reconcileOnePendingCreation(), true);
  assert.equal((retry?.$set as { retryAttempts: number }).retryAttempts, 1);
  assert.ok((retry?.$set as { retryAt: Date }).retryAt instanceof Date);
  assert.deepEqual(retry?.$unset, { leaseId: "", leaseUntil: "" });
});

test("a transferred orphan is isolated for manual reconciliation", async (t) => {
  setCreditConfig(t);
  t.mock.method(OrderCreation, "findOneAndUpdate", (async () => creation) as never);
  t.mock.method(Errand, "findById", (async () => null) as never);
  let finalState = "";
  t.mock.method(OrderCreation, "updateOne", (async (_filter: unknown, update: { $set: { state?: string } }) => {
    finalState = update.$set.state ?? "";
    return { matchedCount: 1 };
  }) as never);
  t.mock.method(globalThis, "fetch", (async () =>
    Response.json({ state: "TRANSFERRED", requesterId, amount: 20, courierId: new Types.ObjectId().toString() })) as never);
  t.mock.method(console, "error", () => {});

  assert.equal(await reconcileOnePendingCreation(), true);
  assert.equal(finalState, "RECONCILE");
});

test("nothing is changed when no creation is due", async (t) => {
  t.mock.method(OrderCreation, "findOneAndUpdate", (async () => null) as never);
  const write = t.mock.method(OrderCreation, "updateOne", (async () => ({})) as never);
  assert.equal(await reconcileOnePendingCreation(), false);
  assert.equal(write.mock.callCount(), 0);
});
