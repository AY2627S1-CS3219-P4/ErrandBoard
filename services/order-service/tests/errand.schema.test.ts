import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { Errand } from "../src/models/Errand.js";

// These run Mongoose's synchronous validators directly against the schema — no DB needed.
// They guard the notifyOutbox sub-schema's actorRole enum, which is what updateErrand writes
// with `runValidators: true` on every transition. When "ADMIN" was missing from that enum,
// admin dispute resolution (resolveRefund / resolveTransfer) failed validation with a 400,
// but the service tests mock the DB so runValidators never fired and the bug slipped through.
describe("Errand schema: notifyOutbox actorRole enum", () => {
  function errandWith(actorRole: string) {
    return new Errand({
      requesterId: "requester-1",
      supplier: { supplierId: "s-1", name: "Fine Food", building: "Town Plaza" },
      dropoff: "COM1 lobby",
      description: "Chicken rice, no chilli",
      credit: 5,
      status: "CANCELLED",
      expiresAt: new Date(Date.now() + 60_000),
      notifyOutbox: [
        {
          eventId: "evt-1",
          status: "CANCELLED",
          previousStatus: "DISPUTED",
          actorRole,
          actorId: "admin-1",
          at: new Date(),
        },
      ],
    });
  }

  test("accepts an ADMIN actor (admin dispute resolution)", () => {
    assert.equal(errandWith("ADMIN").validateSync(), undefined);
  });

  for (const role of ["REQUESTER", "COURIER", "SYSTEM"]) {
    test(`accepts a ${role} actor`, () => {
      assert.equal(errandWith(role).validateSync(), undefined);
    });
  }

  test("rejects an unknown actor role", () => {
    const error = errandWith("MANAGER").validateSync();
    assert.ok(error, "expected a validation error for an out-of-enum actorRole");
    assert.ok(error.errors["notifyOutbox.0.actorRole"], "error should flag the outbox actorRole");
  });
});
