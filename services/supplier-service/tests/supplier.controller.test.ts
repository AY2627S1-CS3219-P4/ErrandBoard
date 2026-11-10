import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { Supplier } from "../src/models/Supplier.js";
import { logger } from "../src/logger.js";
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
  const fakeDoc = { _id: "1", name: "CoffeeBean@Com3", isActive: true };
  t.mock.method(Supplier, "findById", async () => fakeDoc);

  const req = { params: { id: "1" } } as unknown as Request;
  const res = mockResponse();

  await getById(req, res as unknown as Response);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { supplier: fakeDoc });
});

test("getSupplierById throws SupplierNotFoundError if user is not an admin", async (t) => {
  const fakeDoc = { _id: "1", name: "CoffeeBean@Com3", isActive: false };
  t.mock.method(Supplier, "findById", async () => fakeDoc);

  const req = {
    params: { id: "1" },
    user: { userId: "user-1", role: "USER" },
  } as unknown as Request;
  const res = mockResponse();

  await getById(req, res as unknown as Response);

  // The controller translates SupplierNotFoundError into a 404
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: "Supplier not found" });
});

test("getById responds 404 for an inactive supplier when the caller is anonymous", async (t) => {
  const fakeDoc = { _id: "1", name: "CoffeeBean@Com3", isActive: false };
  t.mock.method(Supplier, "findById", async () => fakeDoc);

  const req = { params: { id: "1" } } as unknown as Request;
  const res = mockResponse();

  await getById(req, res as unknown as Response);

  assert.equal(res.statusCode, 404);
});

test("getById responds 200 with an inactive supplier when the caller is an admin", async (t) => {
  const fakeDoc = { _id: "1", name: "CoffeeBean@Com3", isActive: false };
  t.mock.method(Supplier, "findById", async () => fakeDoc);

  const req = {
    params: { id: "1" },
    user: { userId: "admin-1", role: "ADMIN" },
  } as unknown as Request;
  const res = mockResponse();

  await getById(req, res as unknown as Response);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { supplier: fakeDoc });
});

test("getById responds 200 with an inactive supplier when the caller is a superadmin", async (t) => {
  const fakeDoc = { _id: "1", name: "CoffeeBean@Com3", isActive: false };
  t.mock.method(Supplier, "findById", async () => fakeDoc);

  const req = {
    params: { id: "1" },
    user: { userId: "superadmin-1", role: "SUPERADMIN" },
  } as unknown as Request;
  const res = mockResponse();

  await getById(req, res as unknown as Response);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { supplier: fakeDoc });
});

test("list responds 200 without requiring req.user (F7 is public)", async (t) => {
  t.mock.method(Supplier, "find", () => ({ sort: () => [{ _id: "1" }] }));

  const req = { query: {} } as unknown as Request;
  const res = mockResponse();

  await list(req, res as unknown as Response);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { suppliers: [{ _id: "1" }] });
});

test("list ignores showInactive when the caller isn't an admin", async (t) => {
  let capturedQuery: Record<string, unknown> = {};
  t.mock.method(Supplier, "find", (query: Record<string, unknown>) => {
    capturedQuery = query;
    return { sort: () => [] };
  });

  const req = {
    query: { showInactive: "true" },
    user: { userId: "user-1", role: "USER" },
  } as unknown as Request;
  const res = mockResponse();

  await list(req, res as unknown as Response);

  // A non-admin asking for showInactive should still only see active suppliers
  assert.equal(capturedQuery.isActive, true);
});

test("list ignores showInactive when the caller is anonymous", async (t) => {
  let capturedQuery: Record<string, unknown> = {};
  t.mock.method(Supplier, "find", (query: Record<string, unknown>) => {
    capturedQuery = query;
    return { sort: () => [] };
  });

  const req = { query: { showInactive: "true" } } as unknown as Request;
  const res = mockResponse();

  await list(req, res as unknown as Response);

  assert.equal(capturedQuery.isActive, true);
});

test("list includes inactive suppliers when an admin passes showInactive", async (t) => {
  let capturedQuery: Record<string, unknown> = {};
  t.mock.method(Supplier, "find", (query: Record<string, unknown>) => {
    capturedQuery = query;
    return { sort: () => [] };
  });

  const req = {
    query: { showInactive: "true" },
    user: { userId: "admin-1", role: "ADMIN" },
  } as unknown as Request;
  const res = mockResponse();

  await list(req, res as unknown as Response);

  assert.equal("isActive" in capturedQuery, false);
});

test("list still filters to active suppliers for an admin who doesn't pass showInactive", async (t) => {
  let capturedQuery: Record<string, unknown> = {};
  t.mock.method(Supplier, "find", (query: Record<string, unknown>) => {
    capturedQuery = query;
    return { sort: () => [] };
  });

  const req = {
    query: {},
    user: { userId: "admin-1", role: "ADMIN" },
  } as unknown as Request;
  const res = mockResponse();

  await list(req, res as unknown as Response);

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

// --- audit logging (1b) ---
// The controller emits a structured audit event per admin mutation. Tests spy on
// the logger and assert on the event name, the acting admin id, and the fields
// that make the audit trail useful. pino's signature is logger.<level>(obj, msg),
// so the context object is arguments[0].

test("create emits a supplier.created audit event with the admin id", async (t) => {
  t.mock.method(Supplier, "create", async () => ({
    _id: "s1",
    name: "CoffeeBean@Com3",
    category: "FOOD_BEVERAGE",
    building: "COM3",
  }));
  const info = t.mock.method(logger, "info", () => logger);

  const req = {
    body: { name: "CoffeeBean@Com3", category: "FOOD_BEVERAGE", building: "COM3" },
    user: { userId: "admin-1", role: "ADMIN" },
  } as unknown as Request;
  await create(req, mockResponse() as unknown as Response);

  assert.equal(info.mock.callCount(), 1);
  assert.deepEqual(info.mock.calls[0].arguments[0], {
    event: "supplier.created",
    supplierId: "s1",
    adminId: "admin-1",
    supplierName: "CoffeeBean@Com3",
    category: "FOOD_BEVERAGE",
    building: "COM3",
  });
});

test("create emits a supplier.created_rejected warning on a duplicate", async (t) => {
  t.mock.method(Supplier, "create", async () => {
    throw mongoDuplicateKeyError();
  });
  const warn = t.mock.method(logger, "warn", () => logger);

  const req = {
    body: { name: "CoffeeBean@Com3", category: "FOOD_BEVERAGE", building: "COM3" },
    user: { userId: "admin-1", role: "ADMIN" },
  } as unknown as Request;
  await create(req, mockResponse() as unknown as Response);

  assert.equal(warn.mock.callCount(), 1);
  const ctx = warn.mock.calls[0].arguments[0] as Record<string, unknown>;
  assert.equal(ctx.event, "supplier.created_rejected");
  assert.equal(ctx.adminId, "admin-1");
  assert.equal(ctx.reason, "duplicate_supplier");
  // the name+building that define the duplicate must be logged, under a non-reserved
  // key (pino treats a `name` context field as the logger name, hiding it from the body)
  assert.equal(ctx.supplierName, "CoffeeBean@Com3");
  assert.equal(ctx.building, "COM3");
  assert.equal("name" in ctx, false);
});

test("update emits a supplier.updated audit event with the new field values", async (t) => {
  t.mock.method(Supplier, "findByIdAndUpdate", async () => ({ _id: "s1" }));
  const info = t.mock.method(logger, "info", () => logger);

  const req = {
    params: { id: "s1" },
    body: { building: "COM3", name: "New Name" },
    user: { userId: "admin-1", role: "ADMIN" },
  } as unknown as Request;
  await update(req, mockResponse() as unknown as Response);

  assert.equal(info.mock.callCount(), 1);
  const ctx = info.mock.calls[0].arguments[0] as Record<string, unknown>;
  assert.equal(ctx.event, "supplier.updated");
  assert.equal(ctx.supplierId, "s1");
  assert.equal(ctx.adminId, "admin-1");
  // newFields carries the submitted field names and their new values
  assert.deepEqual(ctx.newFields, { building: "COM3", name: "New Name" });
});

test("deactivate emits a supplier.deactivated audit event", async (t) => {
  t.mock.method(Supplier, "findByIdAndUpdate", async () => ({ _id: "s1", isActive: false }));
  const info = t.mock.method(logger, "info", () => logger);

  const req = {
    params: { id: "s1" },
    user: { userId: "admin-1", role: "ADMIN" },
  } as unknown as Request;
  await deactivate(req, mockResponse() as unknown as Response);

  assert.equal(info.mock.callCount(), 1);
  assert.deepEqual(info.mock.calls[0].arguments[0], {
    event: "supplier.deactivated",
    supplierId: "s1",
    adminId: "admin-1",
  });
});
