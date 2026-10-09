import assert from "node:assert/strict";
import { test } from "node:test";
import { provisionCreditAccount } from "../dist/routes/credit.routes.js";
import { UserCredit } from "../dist/models/UserCredit.js";

const userId = "507f1f77bcf86cd799439011";

function request(key, id = userId, body) {
  return {
    params: { userId: id },
    body,
    get: (name) => name === "authorization" ? key : undefined,
  };
}

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    sendStatus(code) { this.statusCode = code; return this; },
  };
}

test("provisioning rejects unauthenticated and invalid callers", async () => {
  process.env.CREDIT_INTERNAL_API_KEY = "test-service-key";
  const missing = response();
  await provisionCreditAccount(request(undefined), missing);
  assert.equal(missing.statusCode, 401);

  const wrong = response();
  await provisionCreditAccount(request("Bearer wrong-key"), wrong);
  assert.equal(wrong.statusCode, 403);
});

test("provisioning fails closed without its service credential", async () => {
  delete process.env.CREDIT_INTERNAL_API_KEY;
  const result = response();
  await provisionCreditAccount(request("Bearer any-key"), result);
  assert.equal(result.statusCode, 503);
  process.env.CREDIT_INTERNAL_API_KEY = "test-service-key";
});

test("provisioning rejects malformed user IDs", async () => {
  process.env.CREDIT_INTERNAL_API_KEY = "test-service-key";
  const result = response();
  await provisionCreditAccount(request("Bearer test-service-key", "not-an-object-id"), result);
  assert.equal(result.statusCode, 400);
});

test("one credit account per user is declared as a unique index", () => {
  assert.ok(UserCredit.schema.indexes().some(([fields, options]) =>
    fields.userId === 1 && options.unique === true,
  ));
});

test("provisioning creates one account with matching ID and initial balances, then only changes status", async () => {
  const original = UserCredit.updateOne;
  let account;
  let insertCount = 0;
  UserCredit.updateOne = async (filter, update, options) => {
    if (!account) {
      assert.equal(options.upsert, true);
      account = { ...update.$setOnInsert, ...update.$set };
      insertCount += 1;
      return { acknowledged: true, matchedCount: 0, upsertedCount: 1 };
    }
    assert.equal(filter.userId.toString(), account.userId.toString());
    account = { ...account, ...update.$set };
    return { acknowledged: true, matchedCount: 1, upsertedCount: 0 };
  };

  try {
    for (const isActive of [true, false, true]) {
      const result = response();
      await provisionCreditAccount(request("Bearer test-service-key", userId, { isActive }), result);
      assert.equal(result.statusCode, 204);
      assert.equal(account.userId.toString(), userId);
      assert.equal(account.available, 100);
      assert.equal(account.reserve, 0);
      assert.equal(account.isActive, isActive);
    }
    assert.equal(insertCount, 1);
  } finally {
    UserCredit.updateOne = original;
  }
});

test("provisioning rejects a non-boolean account status", async () => {
  const result = response();
  await provisionCreditAccount(request("Bearer test-service-key", userId, { isActive: "false" }), result);
  assert.equal(result.statusCode, 400);
});

test("a concurrent unique-index race updates status without resetting the winning balance", async () => {
  const original = UserCredit.updateOne;
  const calls = [];
  UserCredit.updateOne = async (...args) => {
    calls.push(args);
    if (calls.length === 1) throw Object.assign(new Error("duplicate key"), { code: 11000 });
    return { acknowledged: true, matchedCount: 1, upsertedCount: 0 };
  };

  try {
    const result = response();
    await provisionCreditAccount(request("Bearer test-service-key", userId, { isActive: false }), result);
    assert.equal(result.statusCode, 204);
    assert.equal(calls.length, 2);
    assert.equal(calls[1][0].userId.toString(), userId);
    assert.deepEqual(calls[1][1], { $set: { isActive: false } });
  } finally {
    UserCredit.updateOne = original;
  }
});
