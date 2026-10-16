import assert from "node:assert/strict";
import { test } from "node:test";
import mongoose, { Types } from "mongoose";
import { TransactionLog } from "../dist/models/TransactionLog.js";
import { UserCredit } from "../dist/models/UserCredit.js";
import { reserveOrderCredits } from "../dist/routes/credit.routes.js";
import {
  reserveCredits,
  refundCredits,
  transferCredits,
} from "../dist/services/credit-operations.service.js";

const orderId = new Types.ObjectId("507f1f77bcf86cd799439011");
const requesterId = new Types.ObjectId("507f1f77bcf86cd799439012");
const courierId = new Types.ObjectId("507f1f77bcf86cd799439013");
const operation = { orderId, requesterId, amount: 20 };

function fakeDatabase({ available = 100, courierPresent = true } = {}) {
  const original = {
    startSession: mongoose.startSession,
    findOne: TransactionLog.findOne,
    create: TransactionLog.create,
    updateOne: UserCredit.updateOne,
  };
  let logs = [];
  let accounts = {
    [requesterId]: { available, reserve: 0, isActive: true },
    ...(courierPresent ? { [courierId]: { available: 0, reserve: 0, isActive: true } } : {}),
  };
  let transactionCount = 0;

  mongoose.startSession = async () => ({
    async withTransaction(work) {
      transactionCount += 1;
      const beforeLogs = [...logs];
      const beforeAccounts = structuredClone(accounts);
      try { return await work(); }
      catch (error) {
        logs = beforeLogs;
        accounts = beforeAccounts;
        throw error;
      }
    },
    async endSession() {},
  });
  TransactionLog.findOne = (filter) => {
    const find = () => logs.find((log) => log.orderId.equals(filter.orderId) &&
      log.transactionType === filter.transactionType) ?? null;
    return { session: async () => find(), then: (resolve) => Promise.resolve(find()).then(resolve) };
  };
  TransactionLog.create = async ([entry], options) => {
    assert.ok(options.session);
    if (logs.some((log) => log.orderId.equals(entry.orderId) &&
      log.transactionType === entry.transactionType)) {
      throw Object.assign(new Error("duplicate key"), { code: 11000 });
    }
    logs.push(entry);
    return [entry];
  };
  UserCredit.updateOne = async (filter, update, options) => {
    assert.ok(options.session);
    const account = accounts[filter.userId?.toString()];
    if (!account || (filter.isActive !== undefined && account.isActive !== filter.isActive)) return { matchedCount: 0 };
    if (filter.available && account.available < filter.available.$gte) return { matchedCount: 0 };
    if (filter.reserve && account.reserve < filter.reserve.$gte) return { matchedCount: 0 };
    for (const [field, change] of Object.entries(update.$inc)) account[field] += change;
    return { matchedCount: 1 };
  };
  return {
    get logs() { return logs; },
    get accounts() { return accounts; },
    get transactionCount() { return transactionCount; },
    restore() {
      mongoose.startSession = original.startSession;
      TransactionLog.findOne = original.findOne;
      TransactionLog.create = original.create;
      UserCredit.updateOne = original.updateOne;
    },
  };
}

test("one reserve records ORDER_START, moves credits, and a repeat does nothing", async () => {
  const db = fakeDatabase();
  try {
    assert.deepEqual(await reserveCredits(operation), { applied: true });
    assert.deepEqual(await reserveCredits(operation), { applied: false });
    assert.equal(db.logs.length, 1);
    assert.equal(db.logs[0].transactionType, "ORDER_START");
    assert.equal(db.accounts[requesterId].available, 80);
    assert.equal(db.accounts[requesterId].reserve, 20);
  } finally { db.restore(); }
});

test("insufficient available balance rolls back the log and balance", async () => {
  const db = fakeDatabase({ available: 10 });
  try {
    await assert.rejects(reserveCredits(operation), { status: 409 });
    assert.equal(db.logs.length, 0);
    assert.equal(db.accounts[requesterId].available, 10);
    assert.equal(db.accounts[requesterId].reserve, 0);
  } finally { db.restore(); }
});

test("a reused orderId with a different reservation amount is a conflict", async () => {
  const db = fakeDatabase();
  try {
    await reserveCredits(operation);
    await assert.rejects(reserveCredits({ ...operation, amount: 30 }), { status: 409 });
    assert.equal(db.logs.length, 1);
    assert.equal(db.accounts[requesterId].available, 80);
    assert.equal(db.accounts[requesterId].reserve, 20);
  } finally { db.restore(); }
});

test("ORDER_END needs a matching reservation", async () => {
  const db = fakeDatabase();
  try {
    await assert.rejects(refundCredits(operation), { status: 409 });
    assert.equal(db.logs.length, 0);
  } finally { db.restore(); }
});

test("refund restores available balance and prevents a later transfer", async () => {
  const db = fakeDatabase();
  try {
    await reserveCredits(operation);
    assert.deepEqual(await refundCredits(operation), { applied: true });
    assert.deepEqual(await refundCredits(operation), { applied: false });
    await assert.rejects(transferCredits({ ...operation, courierId }), { status: 409 });
    assert.equal(db.logs.length, 2);
    assert.equal(db.accounts[requesterId].available, 100);
    assert.equal(db.accounts[requesterId].reserve, 0);
    assert.equal(db.accounts[courierId].available, 0);
  } finally { db.restore(); }
});

test("transfer atomically debits reserve and credits courier once", async () => {
  const db = fakeDatabase();
  try {
    await reserveCredits(operation);
    assert.deepEqual(await transferCredits({ ...operation, courierId }), { applied: true });
    assert.deepEqual(await transferCredits({ ...operation, courierId }), { applied: false });
    assert.equal(db.logs.length, 2);
    assert.equal(db.logs[1].action, "TRANSFER");
    assert.equal(db.accounts[requesterId].reserve, 0);
    assert.equal(db.accounts[courierId].available, 20);
  } finally { db.restore(); }
});

test("missing courier rolls back both the requester debit and ORDER_END log", async () => {
  const db = fakeDatabase({ courierPresent: false });
  try {
    await reserveCredits(operation);
    await assert.rejects(transferCredits({ ...operation, courierId }), { status: 409 });
    assert.equal(db.logs.length, 1);
    assert.equal(db.accounts[requesterId].reserve, 20);
    assert.equal(db.accounts[courierId], undefined);
  } finally { db.restore(); }
});

test("deactivation blocks new reserves but does not trap a prior reservation", async () => {
  const db = fakeDatabase();
  try {
    await reserveCredits(operation);
    db.accounts[requesterId].isActive = false;
    db.accounts[courierId].isActive = false;
    await transferCredits({ ...operation, courierId });
    assert.equal(db.accounts[requesterId].reserve, 0);
    assert.equal(db.accounts[courierId].available, 20);
    await assert.rejects(reserveCredits({ ...operation, orderId: new Types.ObjectId() }), { status: 409 });
  } finally { db.restore(); }
});

test("operation log declares unique orderId and transactionType", () => {
  assert.ok(TransactionLog.schema.indexes().some(([fields, options]) =>
    fields.orderId === 1 && fields.transactionType === 1 && options.unique === true,
  ));
});

test("reservation API rejects missing credentials, wrong credentials, and malformed input", async () => {
  process.env.ORDER_CREDIT_API_KEY = "test-order-key";
  const response = () => ({
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  });
  const request = (authorization, body) => ({
    get: (name) => name === "authorization" ? authorization : undefined,
    body,
  });
  const valid = { orderId: orderId.toString(), requesterId: requesterId.toString(), amount: 20 };
  try {
    for (const [authorization, body, expected] of [
      [undefined, valid, 401],
      ["Bearer wrong", valid, 403],
      ["Bearer test-order-key", { ...valid, amount: 0 }, 400],
      ["Bearer test-order-key", { ...valid, orderId: "invalid" }, 400],
    ]) {
      const res = response();
      await reserveOrderCredits(request(authorization, body), res);
      assert.equal(res.statusCode, expected);
    }
  } finally {
    delete process.env.ORDER_CREDIT_API_KEY;
  }
});
