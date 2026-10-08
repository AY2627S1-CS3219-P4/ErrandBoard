import assert from "node:assert/strict";
import { test } from "node:test";
import { provisionCreditAccount } from "../dist/routes/credit.routes.js";
import { UserCredit } from "../dist/models/UserCredit.js";

const userId = "507f1f77bcf86cd799439011";

function request(key, id = userId) {
  return {
    params: { userId: id },
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

test("repeated provisioning uses insert-only defaults", async () => {
  const original = UserCredit.updateOne;
  const calls = [];
  UserCredit.updateOne = async (...args) => {
    calls.push(args);
    return { acknowledged: true, matchedCount: calls.length - 1, upsertedCount: 1 };
  };

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = response();
      await provisionCreditAccount(request("Bearer test-service-key"), result);
      assert.equal(result.statusCode, 204);
    }
    assert.equal(calls.length, 2);
    for (const [filter, update, options] of calls) {
      assert.equal(filter.userId.toString(), userId);
      assert.equal(update.$setOnInsert.available, 100);
      assert.equal(update.$setOnInsert.reserve, 0);
      assert.equal(options.upsert, true);
      assert.equal(update.$set, undefined);
    }
  } finally {
    UserCredit.updateOne = original;
  }
});
