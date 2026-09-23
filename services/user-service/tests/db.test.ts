import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import mongoose from "mongoose";
import { connectDb } from "../src/db.js";

const keys = ["MONGO_USER_SERVICE_PASSWORD", "MONGO_HOST", "MONGO_DB_NAME"] as const;
let original: (string | undefined)[];

beforeEach(() => {
  original = keys.map((key) => process.env[key]);
  process.env.MONGO_USER_SERVICE_PASSWORD = "unit-test-password";
  process.env.MONGO_HOST = "mongodb";
  process.env.MONGO_DB_NAME = "errandboard_test";
});

afterEach(() => {
  keys.forEach((key, index) => {
    if (original[index] === undefined) delete process.env[key];
    else process.env[key] = original[index];
  });
});

test("connection uses the configured database and service credentials without a stray brace", async (t) => {
  const connect = t.mock.method(mongoose, "connect", async () => mongoose);
  await connectDb();
  assert.equal(connect.mock.callCount(), 1);
  const [uri, options] = connect.mock.calls[0]!.arguments;
  assert.equal(uri, "mongodb://mongodb:27017/errandboard_test");
  assert.equal(options?.authSource, "errandboard_test");
  assert.equal(options?.user, "user_service");
  assert.equal(options?.pass, "unit-test-password");
});

test("missing database password fails before attempting a connection", async (t) => {
  delete process.env.MONGO_USER_SERVICE_PASSWORD;
  const connect = t.mock.method(mongoose, "connect", async () => mongoose);
  await assert.rejects(connectDb(), /MONGO_USER_SERVICE_PASSWORD missing/);
  assert.equal(connect.mock.callCount(), 0);
});

test("connection failures reach the startup caller", async (t) => {
  const failure = new Error("database authentication failed");
  t.mock.method(mongoose, "connect", async () => { throw failure; });
  await assert.rejects(connectDb(), (error) => error === failure);
});
