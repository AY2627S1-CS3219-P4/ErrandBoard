import assert from "node:assert/strict";
import { test } from "node:test";
import { Supplier } from "../src/models/Supplier.js";

async function validationErrors(supplier: InstanceType<typeof Supplier>) {
  try {
    await supplier.validate();
    return undefined;
  } catch (error) {
    return error as import("mongoose").Error.ValidationError;
  }
}

test("rejects a supplier missing required fields", async () => {
  const supplier = new Supplier({});
  const error = await validationErrors(supplier);

  assert.ok(error, "expected a validation error");
  assert.ok(error?.errors.name);
  assert.ok(error?.errors.category);
  assert.ok(error?.errors.building);
});

test("rejects a category outside the fixed enum", async () => {
  const supplier = new Supplier({
    name: "CoffeeBean@Com3",
    category: "FAKE_CATEGORY",
    building: "COM3",
    address: "teststreet1_123"
  });

  const error = await validationErrors(supplier);
  assert.ok(error?.errors.category);
});

test("accepts a minimal valid supplier and defaults isActive to true", async () => {
  const supplier = new Supplier({
    name: "CoffeeBean@Com3",
    category: "FOOD_BEVERAGE",
    building: "COM3",
    address: "teststreet1_123"
  });

  const error = await validationErrors(supplier);
  assert.equal(error, undefined);
  assert.equal(supplier.isActive, true);
});

