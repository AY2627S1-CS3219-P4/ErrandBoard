import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { Supplier } from "../src/models/Supplier.js";
import {
  create,
  deactivate,
  getById,
  list,
  update,
} from "../src/controllers/supplier.controller.js";

// mock express response
function mockResponse() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function mongoDuplicateKeyError(): Error & { code: number } {
  const error = new Error("E11000 duplicate key error") as Error & {
    code: number;
  };
  error.code = 11000;
  return error;
}

test("create responds 201 with the created supplier", async (t) => {
  const fakeDoc = { _id: "1", name: "CoffeeBean@Com3" };
  t.mock.method(Supplier, "create", async () => fakeDoc);

  const req = {
    body: { name: "CoffeeBean@Com3", category: "FOOD_BEVERAGE", building: "COM3" },
  } as Request;
  const res = mockResponse();

  await create(req, res as unknown as Response);

  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { supplier: fakeDoc });
});

test("create responds 409 when the service reports a duplicate", async (t) => {
  t.mock.method(Supplier, "create", async () => {
    throw mongoDuplicateKeyError();
  });

  const req = {
    body: { name: "CoffeeBean@Com3", category: "FOOD_BEVERAGE", building: "COM3" },
  } as Request;
  const res = mockResponse();

  await create(req, res as unknown as Response);

  assert.equal(res.statusCode, 409);
});

test("getById responds 404 when the supplier doesn't exist", async (t) => {
  t.mock.method(Supplier, "findById", async () => null);

  const req = { params: { id: "missing" } } as unknown as Request;
  const res = mockResponse();

  await getById(req, res as unknown as Response);

  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: "Supplier not found" });
});

test("getById responds 200 with the supplier when found", async (t) => {
  const fakeDoc = { _id: "1", name: "CoffeeBean@Com3" };
  t.mock.method(Supplier, "findById", async () => fakeDoc);

  const req = { params: { id: "1" } } as unknown as Request;
  const res = mockResponse();

  await getById(req, res as unknown as Response);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { supplier: fakeDoc });
});

test("list responds 200 without requiring req.auth (F7 is public)", async (t) => {
  t.mock.method(Supplier, "find", () => ({ sort: () => [{ _id: "1" }] }));

  const req = { query: {} } as unknown as Request;
  const res = mockResponse();

  await list(req, res as unknown as Response);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { suppliers: [{ _id: "1" }] });
});

test("list ignores includeInactive when the caller isn't an admin", async (t) => {
  let capturedQuery: Record<string, unknown> = {};
  t.mock.method(Supplier, "find", (query: Record<string, unknown>) => {
    capturedQuery = query;
    return { sort: () => [] };
  });

  const req = {
    query: { includeInactive: "true" },
    auth: { sub: "user-1", accountType: "USER" },
  } as unknown as Request;
  const res = mockResponse();

  await list(req, res as unknown as Response);

  // A non-admin asking for showInactive should still only see active suppliers
  assert.equal(capturedQuery.isActive, true);
});

test("update responds 409 on a duplicate name+building", async (t) => {
  t.mock.method(Supplier, "findByIdAndUpdate", async () => {
    throw mongoDuplicateKeyError();
  });

  const req = {
    params: { id: "1" },
    body: { building: "COM3" },
  } as unknown as Request;
  const res = mockResponse();

  await update(req, res as unknown as Response);

  assert.equal(res.statusCode, 409);
});

test("deactivate responds 200 with the soft-deleted supplier (F6.2.4)", async (t) => {
  const fakeDoc = { _id: "1", isActive: false };
  t.mock.method(Supplier, "findByIdAndUpdate", async () => fakeDoc);

  const req = { params: { id: "1" } } as unknown as Request;
  const res = mockResponse();

  await deactivate(req, res as unknown as Response);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { supplier: fakeDoc });
});

test("deactivate responds 404 for a missing supplier", async (t) => {
  t.mock.method(Supplier, "findByIdAndUpdate", async () => null);

  const req = { params: { id: "missing" } } as unknown as Request;
  const res = mockResponse();

  await deactivate(req, res as unknown as Response);

  assert.equal(res.statusCode, 404);
});
