import assert from "node:assert/strict";
import { test } from "node:test";
import { Supplier } from "../src/models/Supplier.js";
import {
  createSupplier,
  deactivateSupplier,
  DuplicateSupplierError,
  getSupplierById,
  listSuppliers,
  SupplierNotFoundError,
  updateSupplier,
} from "../src/services/supplier.service.js";

function mongoDuplicateKeyError(): Error & { code: number } {
  const error = new Error("E11000 duplicate key error") as Error & {
    code: number;
  };
  error.code = 11000;
  return error;
}

test("createSupplier returns whatever the model returns on success", async (t) => {
  const fakeDoc = { _id: "1", name: "CoffeeBean@Com3" };
  t.mock.method(Supplier, "create", async () => fakeDoc);

  const result = await createSupplier({
    name: "CoffeeBean@Com3",
    category: "FOOD_BEVERAGE",
    building: "COM3",
    address: "test_address"
  });

  assert.equal(result, fakeDoc);
});

test("createSupplier translates a Mongo duplicate-key error (F6.3.2)", async (t) => {
  t.mock.method(Supplier, "create", async () => {
    throw mongoDuplicateKeyError();
  });

  await assert.rejects(
    () =>
      createSupplier({
        name: "CoffeeBean@Com3",
        category: "FOOD_BEVERAGE",
        building: "COM3",
        address: "test_address"
      }),
    DuplicateSupplierError,
  );
});

test("createSupplier rethrows errors that aren't duplicate-key errors", async (t) => {
  t.mock.method(Supplier, "create", async () => {
    throw new Error("connection lost");
  });

  await assert.rejects(
    () =>
      createSupplier({
        name: "CoffeeBean@Com3",
        category: "FOOD_BEVERAGE",
        building: "COM3",
        address: "test_address"
      }),
    /connection lost/,
  );
});

test("listSuppliers filters to active suppliers by default", async (t) => {
  let capturedQuery: unknown;
  t.mock.method(Supplier, "find", (query: unknown) => {
    capturedQuery = query;
    return { sort: () => [] };
  });

  await listSuppliers({});

  assert.deepEqual(capturedQuery, { isActive: true });
});

test("listSuppliers omits the isActive filter when includeInactive is true (F6.2.2)", async (t) => {
  let capturedQuery: Record<string, unknown> = {};
  t.mock.method(Supplier, "find", (query: Record<string, unknown>) => {
    capturedQuery = query;
    return { sort: () => [] };
  });

  await listSuppliers({ showInactive: true });

  assert.equal("isActive" in capturedQuery, false);
});

test("listSuppliers builds a case-insensitive, partial-match search (F7.2.2)", async (t) => {
  let capturedQuery: any;
  t.mock.method(Supplier, "find", (query: any) => {
    capturedQuery = query;
    return { sort: () => [] };
  });

  await listSuppliers({ search: "coffee" });

  assert.equal(capturedQuery.name.$regex, "coffee");
  assert.equal(capturedQuery.name.$options, "i");
});

test("listSuppliers escapes regex special characters in search input", async (t) => {
  let capturedQuery: any;
  t.mock.method(Supplier, "find", (query: any) => {
    capturedQuery = query;
    return { sort: () => [] };
  });

  // Without escaping, "a.b*c" would be interpreted as a regex pattern
  // rather than a literal search string.
  await listSuppliers({ search: "a.b*c" });

  assert.equal(capturedQuery.name.$regex, "a\\.b\\*c");
});

test("listSuppliers applies category and building filters via $in", async (t) => {
  let capturedQuery: any;
  t.mock.method(Supplier, "find", (query: any) => {
    capturedQuery = query;
    return { sort: () => [] };
  });

  await listSuppliers({
    category: ["FOOD_BEVERAGE", "RETAIL"],
    building: ["COM3"],
  });

  assert.deepEqual(capturedQuery.category, {
    $in: ["FOOD_BEVERAGE", "RETAIL"],
  });
  assert.deepEqual(capturedQuery.building, { $in: ["COM3"] });
});

test("getSupplierById throws SupplierNotFoundError when nothing matches", async (t) => {
  t.mock.method(Supplier, "findById", async () => null);

  await assert.rejects(
    () => getSupplierById("missing-id"),
    SupplierNotFoundError,
  );
});

test("getSupplierById returns the document when found", async (t) => {
  const fakeDoc = { _id: "1", name: "CoffeeBean@Com3" };
  t.mock.method(Supplier, "findById", async () => fakeDoc);

  const result = await getSupplierById("1");
  assert.equal(result, fakeDoc);
});

test("updateSupplier throws SupplierNotFoundError for a missing id", async (t) => {
  t.mock.method(Supplier, "findByIdAndUpdate", async () => null);

  await assert.rejects(
    () => updateSupplier("missing-id", { name: "New name" }),
    SupplierNotFoundError,
  );
});

test("updateSupplier translates a duplicate-key error on update", async (t) => {
  t.mock.method(Supplier, "findByIdAndUpdate", async () => {
    throw mongoDuplicateKeyError();
  });

  await assert.rejects(
    () => updateSupplier("1", { building: "COM3" }),
    DuplicateSupplierError,
  );
});

test("deactivateSupplier only ever sets isActive to false (F6.2.4)", async (t) => {
  let capturedUpdate: unknown;
  t.mock.method(
    Supplier,
    "findByIdAndUpdate",
    async (_id: string, update: unknown) => {
      capturedUpdate = update;
      return { _id: "1", isActive: false };
    },
  );

  await deactivateSupplier("1");

  assert.deepEqual(capturedUpdate, { $set: { isActive: false } });
});

test("deactivateSupplier throws SupplierNotFoundError for a missing id", async (t) => {
  t.mock.method(Supplier, "findByIdAndUpdate", async () => null);

  await assert.rejects(() => deactivateSupplier("missing-id"), SupplierNotFoundError);
});
