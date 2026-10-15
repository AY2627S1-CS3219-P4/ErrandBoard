import assert from "node:assert/strict";
import { describe, test, type TestContext } from "node:test";
import { Errand, type ErrandRecord } from "../src/models/Errand.js";
import {
  ErrandNotFoundError,
  SelfAssignErrandError,
  UpdateConflictError,
} from "../src/errors/order.errors.js";
import {
  acceptErrand,
  cancelErrand,
  cancelErrandByCourier,
  cancelErrandByRequester,
  completeErrand,
  createErrand,
  deliverErrand,
  escapeRegex,
  getErrand,
  isObjectIdString,
  listMyErrands,
  listOpenErrands,
  pickUpErrand,
  type CreateErrandInput,
} from "../src/services/order.services.js";

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
const ERRAND_ID = "507f1f77bcf86cd799439011";
const REQUESTER_ID = "requester-1";
const COURIER_ID = "courier-1";
const OUTSIDER_ID = "outsider-1";

const supplier = {
  supplierId: "supplier-1",
  name: "Fine Food",
  building: "Town Plaza",
  address: "1 Create Way",
};

function makeErrand(overrides: Partial<ErrandRecord> = {}): ErrandRecord {
  return {
    _id: ERRAND_ID,
    requesterId: REQUESTER_ID,
    supplier,
    dropoff: "COM1 lobby",
    description: "Chicken rice, no chilli",
    credit: 5,
    status: "OPEN",
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as ErrandRecord;
}

// instanceof alone is not enough: it would also pass if an error class had the wrong prototype
function isError(expected: new (...args: never[]) => Error) {
  return (error: unknown) => error instanceof expected && (error as Error).name === expected.name;
}

type UpdateCall = { filter: Record<string, unknown>; update: { $set: Record<string, unknown> }; options: unknown };

// Mocks the atomic update. `result` is what the update matched; `existing` is what the follow-up lookup finds.
function mockUpdate(t: TestContext, result: ErrandRecord | null, existing: ErrandRecord | null = result) {
  const calls: UpdateCall[] = [];
  t.mock.method(Errand, "findOneAndUpdate", (async (filter: Record<string, unknown>, update: UpdateCall["update"], options: unknown) => {
    calls.push({ filter, update, options });
    return result;
  }) as never);
  t.mock.method(Errand, "findById", (async () => existing) as never);
  return calls;
}

function mockFind(t: TestContext, results: ErrandRecord[] = []) {
  const calls: { query: Record<string, unknown>; sort?: unknown }[] = [];
  t.mock.method(Errand, "find", ((query: Record<string, unknown>) => {
    const call: (typeof calls)[number] = { query };
    calls.push(call);
    return {
      sort: async (sort: unknown) => {
        call.sort = sort;
        return results;
      },
    };
  }) as never);
  return calls;
}

function assertWithin(date: unknown, earliest: number, latest: number) {
  assert.ok(date instanceof Date, "expected a Date");
  assert.ok(date.getTime() >= earliest && date.getTime() <= latest, `${date.toISOString()} outside expected range`);
}

describe("utilities", () => {
  test("escapeRegex escapes every regex metacharacter", () => {
    const input = "a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o";
    const pattern = new RegExp(`^${escapeRegex(input)}$`);
    assert.equal(pattern.test(input), true);
    assert.equal(new RegExp(escapeRegex(".*")).test("anything"), false);
  });

  test("isObjectIdString accepts only 24-character hex strings", () => {
    assert.equal(isObjectIdString(ERRAND_ID), true);
    assert.equal(isObjectIdString(ERRAND_ID.toUpperCase()), true);
    assert.equal(isObjectIdString("507f1f77bcf86cd79943901"), false);
    assert.equal(isObjectIdString("507f1f77bcf86cd79943901z"), false);
    assert.equal(isObjectIdString(123), false);
    assert.equal(isObjectIdString(undefined), false);
  });
});

describe("error classes", () => {
  test("each error is an instance of its own class only", () => {
    const errors = [new ErrandNotFoundError(), new UpdateConflictError(), new SelfAssignErrandError()];
    for (const error of errors) {
      assert.ok(error instanceof Error);
      assert.equal(Object.getPrototypeOf(error), error.constructor.prototype, `${error.name} has the wrong prototype`);
    }
    assert.ok(!(new UpdateConflictError() instanceof ErrandNotFoundError));
    assert.ok(!(new SelfAssignErrandError() instanceof ErrandNotFoundError));
  });
});

describe("listOpenErrands", () => {
  test("only returns open, unexpired errands, newest first", async (t) => {
    const errands = [makeErrand()];
    const calls = mockFind(t, errands);

    const before = Date.now();
    const result = await listOpenErrands(OUTSIDER_ID, {});

    assert.equal(result, errands);
    assert.equal(calls.length, 1);
    const { status, expiresAt, ...rest } = calls[0].query as { status: string; expiresAt: { $gt: Date } };
    assert.equal(status, "OPEN");
    assertWithin(expiresAt.$gt, before, Date.now());
    assert.deepEqual(rest, {});
    assert.deepEqual(calls[0].sort, { createdAt: -1 });
  });

  test("maps supplier filters to the embedded supplier fields", async (t) => {
    const calls = mockFind(t);
    await listOpenErrands(OUTSIDER_ID, {
      supplierId: ["s1", "s2"],
      building: ["Town Plaza"],
      address: ["1 Create Way"],
    });

    const query = calls[0].query;
    assert.deepEqual(query["supplier.supplierId"], { $in: ["s1", "s2"] });
    assert.deepEqual(query["supplier.building"], { $in: ["Town Plaza"] });
    assert.deepEqual(query["supplier.address"], { $in: ["1 Create Way"] });
  });

  test("ignores empty supplier filter arrays", async (t) => {
    const calls = mockFind(t);
    await listOpenErrands(OUTSIDER_ID, { supplierId: [], building: [], address: [] });
    assert.deepEqual(Object.keys(calls[0].query).sort(), ["expiresAt", "status"]);
  });

  test("dropoff filter is a case-insensitive, regex-escaped substring match", async (t) => {
    const calls = mockFind(t);
    await listOpenErrands(OUTSIDER_ID, { dropoff: "COM1 (lobby)" });
    assert.deepEqual(calls[0].query.dropoff, { $regex: "COM1 \\(lobby\\)", $options: "i" });
  });

  test("keyword filter searches the errand description", async (t) => {
    const calls = mockFind(t);
    await listOpenErrands(OUTSIDER_ID, { q: "rice" });
    assert.deepEqual(calls[0].query.description, { $regex: "rice", $options: "i" });
    assert.equal(calls[0].query.q, undefined, "q is not a field on the Errand schema");
  });

  test("since filter is applied to the creation time", async (t) => {
    const calls = mockFind(t);
    const since = new Date("2026-10-01T00:00:00Z");
    await listOpenErrands(OUTSIDER_ID, { since });
    assert.deepEqual(calls[0].query.createdAt, { $gte: since });
    assert.equal(calls[0].query.since, undefined, "since is not a field on the Errand schema");
  });
});

describe("listMyErrands", () => {
  test("returns active errands where the user is requester or courier, most recently updated first", async (t) => {
    const calls = mockFind(t);
    await listMyErrands(COURIER_ID);

    assert.deepEqual(calls[0].query, {
      status: { $in: ["OPEN", "ACCEPTED", "PICKED_UP", "PENDING_COMPLETION"] },
      $or: [{ requesterId: COURIER_ID }, { courierId: COURIER_ID }],
    });
    assert.deepEqual(calls[0].sort, { updatedAt: -1 });
  });
});

describe("getErrand", () => {
  test("rejects malformed ids without querying the database", async (t) => {
    const findById = t.mock.method(Errand, "findById", (async () => makeErrand()) as never);
    await assert.rejects(getErrand(REQUESTER_ID, "not-an-id"), isError(ErrandNotFoundError));
    assert.equal(findById.mock.callCount(), 0);
  });

  test("throws not found when the errand does not exist", async (t) => {
    t.mock.method(Errand, "findById", (async () => null) as never);
    await assert.rejects(getErrand(REQUESTER_ID, ERRAND_ID), isError(ErrandNotFoundError));
  });

  test("requester and courier can see their errand in any status", async (t) => {
    const errand = makeErrand({ status: "PICKED_UP", courierId: COURIER_ID });
    t.mock.method(Errand, "findById", (async () => errand) as never);
    assert.equal(await getErrand(REQUESTER_ID, ERRAND_ID), errand);
    assert.equal(await getErrand(COURIER_ID, ERRAND_ID), errand);
  });

  test("anyone can see an open, unexpired listing", async (t) => {
    const errand = makeErrand();
    t.mock.method(Errand, "findById", (async () => errand) as never);
    assert.equal(await getErrand(OUTSIDER_ID, ERRAND_ID), errand);
  });

  test("outsiders cannot see an accepted errand", async (t) => {
    t.mock.method(Errand, "findById", (async () => makeErrand({ status: "ACCEPTED", courierId: COURIER_ID })) as never);
    await assert.rejects(getErrand(OUTSIDER_ID, ERRAND_ID), isError(ErrandNotFoundError));
  });

  test("outsiders cannot see an open errand that has expired", async (t) => {
    t.mock.method(Errand, "findById", (async () => makeErrand({ expiresAt: new Date(Date.now() - 1000) })) as never);
    await assert.rejects(getErrand(OUTSIDER_ID, ERRAND_ID), isError(ErrandNotFoundError));
  });
});

describe("createErrand", () => {
  test("persists the input as an OPEN errand that expires in two days", async (t) => {
    const input: CreateErrandInput = {
      requesterId: REQUESTER_ID,
      supplier,
      dropoff: "COM1 lobby",
      description: "Chicken rice",
      credit: 5,
    };
    let persisted: Record<string, unknown> | undefined;
    t.mock.method(Errand, "create", (async (document: Record<string, unknown>) => {
      persisted = document;
      return makeErrand(document);
    }) as never);

    const before = Date.now();
    await createErrand(input);
    const after = Date.now();

    assert.ok(persisted);
    const { status, expiresAt, ...rest } = persisted;
    assert.equal(status, "OPEN");
    assertWithin(expiresAt, before + TWO_DAYS_MS, after + TWO_DAYS_MS);
    assert.deepEqual(rest, input);
  });

  test("ignores a status or courier smuggled into the input", async (t) => {
    let persisted: Record<string, unknown> | undefined;
    t.mock.method(Errand, "create", (async (document: Record<string, unknown>) => {
      persisted = document;
      return makeErrand(document);
    }) as never);

    const input = { requesterId: REQUESTER_ID, supplier, dropoff: "x", description: "y", credit: 1, status: "COMPLETED" };
    await createErrand(input as CreateErrandInput);
    assert.equal(persisted?.status, "OPEN");
  });

  test("propagates database errors", async (t) => {
    const failure = new Error("database unavailable");
    t.mock.method(Errand, "create", (async () => { throw failure; }) as never);
    await assert.rejects(
      createErrand({ requesterId: REQUESTER_ID, supplier, dropoff: "x", description: "y", credit: 1 }),
      (error) => error === failure,
    );
  });
});

describe("acceptErrand", () => {
  test("atomically assigns the courier to an open, unassigned, unexpired errand", async (t) => {
    const accepted = makeErrand({ status: "ACCEPTED", courierId: COURIER_ID });
    const calls = mockUpdate(t, accepted);

    const before = Date.now();
    assert.equal(await acceptErrand(ERRAND_ID, COURIER_ID), accepted);

    assert.equal(calls.length, 1);
    const { expiresAt, ...filter } = calls[0].filter as { expiresAt: { $gt: Date } };
    assertWithin(expiresAt.$gt, before, Date.now());
    assert.deepEqual(filter, {
      _id: ERRAND_ID,
      status: "OPEN",
      courierId: { $exists: false },
      requesterId: { $ne: COURIER_ID },
    });
    assert.deepEqual(calls[0].update, { $set: { status: "ACCEPTED", courierId: COURIER_ID } });
    assert.deepEqual(calls[0].options, { new: true, runValidators: true });
  });

  test("requester cannot accept their own errand", async (t) => {
    mockUpdate(t, null, makeErrand());
    await assert.rejects(acceptErrand(ERRAND_ID, REQUESTER_ID), isError(SelfAssignErrandError));
  });

  test("errand already taken by another courier is a conflict", async (t) => {
    mockUpdate(t, null, makeErrand({ status: "ACCEPTED", courierId: "courier-2" }));
    await assert.rejects(acceptErrand(ERRAND_ID, COURIER_ID), isError(UpdateConflictError));
  });

  test("expired errand is a conflict", async (t) => {
    mockUpdate(t, null, makeErrand({ expiresAt: new Date(Date.now() - 1000) }));
    await assert.rejects(acceptErrand(ERRAND_ID, COURIER_ID), isError(UpdateConflictError));
  });

  test("missing errand is not found", async (t) => {
    mockUpdate(t, null, null);
    await assert.rejects(acceptErrand(ERRAND_ID, COURIER_ID), isError(ErrandNotFoundError));
  });

  test("database errors are propagated unchanged", async (t) => {
    const failure = new Error("database unavailable");
    t.mock.method(Errand, "findOneAndUpdate", (async () => { throw failure; }) as never);
    t.mock.method(Errand, "findById", (async () => makeErrand()) as never);
    await assert.rejects(acceptErrand(ERRAND_ID, COURIER_ID), (error) => error === failure);
  });
});

describe("pickUpErrand", () => {
  test("assigned courier moves ACCEPTED -> PICKED_UP and gets a completion deadline", async (t) => {
    const pickedUp = makeErrand({ status: "PICKED_UP", courierId: COURIER_ID });
    const calls = mockUpdate(t, pickedUp);

    const before = Date.now();
    assert.equal(await pickUpErrand(ERRAND_ID, COURIER_ID), pickedUp);
    const after = Date.now();

    assert.deepEqual(calls[0].filter, { _id: ERRAND_ID, status: "ACCEPTED", courierId: COURIER_ID });
    const { completeBy, ...set } = calls[0].update.$set;
    assert.deepEqual(set, { status: "PICKED_UP" });
    assertWithin(completeBy, before + TWO_DAYS_MS, after + TWO_DAYS_MS);
  });

  test("does not filter on listing expiry", async (t) => {
    const calls = mockUpdate(t, makeErrand({ status: "PICKED_UP", courierId: COURIER_ID }));
    await pickUpErrand(ERRAND_ID, COURIER_ID);
    assert.equal(calls[0].filter.expiresAt, undefined);
  });

  test("another courier or wrong status is a conflict", async (t) => {
    mockUpdate(t, null, makeErrand({ status: "ACCEPTED", courierId: "courier-2" }));
    await assert.rejects(pickUpErrand(ERRAND_ID, COURIER_ID), isError(UpdateConflictError));
  });

  test("missing errand is not found", async (t) => {
    mockUpdate(t, null, null);
    await assert.rejects(pickUpErrand(ERRAND_ID, COURIER_ID), isError(ErrandNotFoundError));
  });
});

describe("deliverErrand", () => {
  test("assigned courier moves PICKED_UP -> PENDING_COMPLETION and sets a confirmation deadline", async (t) => {
    const delivered = makeErrand({ status: "PENDING_COMPLETION", courierId: COURIER_ID });
    const calls = mockUpdate(t, delivered);

    const before = Date.now();
    assert.equal(await deliverErrand(ERRAND_ID, COURIER_ID), delivered);
    const after = Date.now();

    assert.deepEqual(calls[0].filter, { _id: ERRAND_ID, status: "PICKED_UP", courierId: COURIER_ID });
    const { confirmBy, ...set } = calls[0].update.$set;
    assert.deepEqual(set, { status: "PENDING_COMPLETION" });
    assertWithin(confirmBy, before + TWO_DAYS_MS, after + TWO_DAYS_MS);
  });

  test("errand not yet picked up is a conflict", async (t) => {
    mockUpdate(t, null, makeErrand({ status: "ACCEPTED", courierId: COURIER_ID }));
    await assert.rejects(deliverErrand(ERRAND_ID, COURIER_ID), isError(UpdateConflictError));
  });
});

describe("completeErrand", () => {
  test("requester moves PENDING_COMPLETION -> COMPLETED", async (t) => {
    const completed = makeErrand({ status: "COMPLETED", courierId: COURIER_ID });
    const calls = mockUpdate(t, completed);

    assert.equal(await completeErrand(ERRAND_ID, REQUESTER_ID), completed);
    assert.deepEqual(calls[0].filter, { _id: ERRAND_ID, status: "PENDING_COMPLETION", requesterId: REQUESTER_ID });
    assert.deepEqual(calls[0].update, { $set: { status: "COMPLETED" } });
  });

  test("courier cannot complete on the requester's behalf", async (t) => {
    mockUpdate(t, null, makeErrand({ status: "PENDING_COMPLETION", courierId: COURIER_ID }));
    await assert.rejects(completeErrand(ERRAND_ID, COURIER_ID), isError(UpdateConflictError));
  });
});

describe("cancellation", () => {
  test("requester can cancel their own OPEN errand", async (t) => {
    const calls = mockUpdate(t, makeErrand({ status: "CANCELLED" }));
    await cancelErrandByRequester(ERRAND_ID, REQUESTER_ID);
    assert.deepEqual(calls[0].filter, { _id: ERRAND_ID, status: "OPEN", requesterId: REQUESTER_ID });
    assert.deepEqual(calls[0].update, { $set: { status: "CANCELLED" } });
  });

  test("requester cannot cancel once a courier has accepted", async (t) => {
    mockUpdate(t, null, makeErrand({ status: "ACCEPTED", courierId: COURIER_ID }));
    await assert.rejects(cancelErrandByRequester(ERRAND_ID, REQUESTER_ID), isError(UpdateConflictError));
  });

  test("courier can cancel an ACCEPTED errand assigned to them", async (t) => {
    const calls = mockUpdate(t, makeErrand({ status: "CANCELLED", courierId: COURIER_ID }));
    await cancelErrandByCourier(ERRAND_ID, COURIER_ID);
    assert.deepEqual(calls[0].filter, { _id: ERRAND_ID, status: "ACCEPTED", courierId: COURIER_ID });
  });

  test("admin cancel moves ACCEPTED -> CANCELLED with no ownership filter", async (t) => {
    const calls = mockUpdate(t, makeErrand({ status: "CANCELLED" }));
    await cancelErrand(ERRAND_ID);
    assert.deepEqual(calls[0].filter, { _id: ERRAND_ID, status: "ACCEPTED" });
    assert.deepEqual(calls[0].update, { $set: { status: "CANCELLED" } });
  });
});
