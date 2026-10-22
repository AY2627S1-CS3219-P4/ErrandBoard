import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test, type TestContext } from "node:test";
import { Errand, type ErrandRecord } from "../src/models/Errand.js";
import { setEventPublisher } from "../src/event/publisher.js";
import {
  DeliveryDeadlinePassedError,
  ErrandNotFoundError,
  SelfAssignErrandError,
  SupplierNotFoundError,
  SupplierUnavailableError,
  UpdateConflictError,
  ValidationError,
} from "../src/errors/order.errors.js";
import {
  acceptErrand,
  cancelErrandByCourier,
  cancelErrandByRequester,
  completeErrand,
  CONFIRMATION_DEADLINE,
  createErrand,
  DELIVERY_DEADLINE,
  deliverErrand,
  escapeRegex,
  EXPIRY_DEADLINE,
  getErrand,
  isObjectIdString,
  listMyErrands,
  listOpenErrands,
  pickUpErrand,
  type CreateErrandInput,
} from "../src/services/order.services.js";

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

// terminal transitions publish an event; inject a no-op publisher so tests never open a real RabbitMQ connection
beforeEach(() => setEventPublisher({ isReady: () => true, publish: async () => {}, close: async () => {} }));
afterEach(() => setEventPublisher(undefined));

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
  // terminal transitions clear the outbox flag after publishing; keep that off the real (unconnected) DB
  t.mock.method(Errand, "updateOne", (async () => ({ acknowledged: true })) as never);
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
  const SUPPLIER_ID = "64b7f0c2a1b2c3d4e5f60718";
  const SUPPLIER_SERVICE_URL = "http://supplier-service:3002";
  const input: CreateErrandInput = {
    requesterId: REQUESTER_ID,
    supplierId: SUPPLIER_ID,
    dropoff: "COM1 lobby",
    description: "Chicken rice",
    credit: 5,
  };
  // what supplier-service returns for GET /suppliers/:id
  const supplierBody = {
    supplier: {
      _id: SUPPLIER_ID,
      name: "Fine Food",
      category: "FOOD_BEVERAGE",
      building: "Town Plaza",
      address: "1 Create Way",
      imageUrl: "https://example.com/fine-food.png",
      isActive: true,
    },
  };

  const CREDIT_SERVICE_URL = "http://credit-service:3004";
  const CREDIT_API_KEY = "test-credit-key";

  // createErrand reserves credits after the supplier lookup; answer that call with success unless a test overrides it
  function useSupplierService(
    t: TestContext,
    respond: (url: string, init?: RequestInit) => Response | Promise<Response>,
    creditRespond: (url: string, init?: RequestInit) => Response | Promise<Response> = () => new Response(null, { status: 201 }),
  ) {
    process.env.SUPPLIER_SERVICE_URL = SUPPLIER_SERVICE_URL;
    process.env.CREDIT_SERVICE_URL = CREDIT_SERVICE_URL;
    process.env.ORDER_CREDIT_API_KEY = CREDIT_API_KEY;
    t.after(() => {
      delete process.env.SUPPLIER_SERVICE_URL;
      delete process.env.CREDIT_SERVICE_URL;
      delete process.env.ORDER_CREDIT_API_KEY;
    });
    return t.mock.method(globalThis, "fetch", (async (url: URL | string, init?: RequestInit) => {
      const target = url.toString();
      if (target.includes("/credit/")) return creditRespond(target, init);
      return respond(target, init);
    }) as never);
  }

  function capturePersisted(t: TestContext) {
    const persisted: Record<string, unknown>[] = [];
    const create = t.mock.method(Errand, "create", (async (document: Record<string, unknown>) => {
      persisted.push(document);
      return makeErrand(document);
    }) as never);
    return { persisted, create };
  }

  test("persists an OPEN errand with the supplier copy from supplier-service", async (t) => {
    const fetchCall = useSupplierService(t, (url, init) => {
      assert.equal(url, `${SUPPLIER_SERVICE_URL}/suppliers/${SUPPLIER_ID}`);
      assert.equal(new Headers(init?.headers).get("authorization"), null, "must use the public endpoint so inactive suppliers are hidden");
      assert.ok(init?.signal, "request must have a timeout");
      return Response.json(supplierBody);
    });
    const { persisted } = capturePersisted(t);

    const before = Date.now();
    await createErrand(input);
    const after = Date.now();

    assert.equal(fetchCall.mock.callCount(), 2); // supplier lookup + credit reservation
    // _id is pre-assigned so the credit reservation can reference the order before it is persisted
    const { status, expiresAt, _id, ...rest } = persisted[0];
    assert.equal(status, "OPEN");
    assert.ok(_id, "errand should be created with a pre-assigned id");
    assertWithin(expiresAt, before + EXPIRY_DEADLINE, after + EXPIRY_DEADLINE);
    assert.deepEqual(rest, {
      requesterId: REQUESTER_ID,
      supplier: {
        supplierId: SUPPLIER_ID,
        name: "Fine Food",
        building: "Town Plaza",
        address: "1 Create Way",
        imageUrl: "https://example.com/fine-food.png",
      },
      dropoff: "COM1 lobby",
      description: "Chicken rice",
      credit: 5,
    });
  });

  test("ignores a supplier copy, status or courier smuggled into the input", async (t) => {
    useSupplierService(t, () => Response.json(supplierBody));
    const { persisted } = capturePersisted(t);

    const smuggled = { ...input, supplier: { name: "Fake Shop" }, status: "COMPLETED", courierId: COURIER_ID };
    await createErrand(smuggled as CreateErrandInput);

    assert.equal(persisted[0].status, "OPEN");
    assert.equal(persisted[0].courierId, undefined);
    assert.equal((persisted[0].supplier as { name: string }).name, "Fine Food");
  });

  test("rejects a malformed supplierId without calling supplier-service", async (t) => {
    const fetchCall = useSupplierService(t, () => Response.json(supplierBody));
    const { create } = capturePersisted(t);

    await assert.rejects(createErrand({ ...input, supplierId: "not-an-id" }), (error) =>
      isError(ValidationError)(error) && "supplierId" in (error as ValidationError).fields);
    await assert.rejects(createErrand({ ...input, supplierId: undefined as unknown as string }), isError(ValidationError));
    assert.equal(fetchCall.mock.callCount(), 0);
    assert.equal(create.mock.callCount(), 0);
  });

  test("missing or deactivated supplier is not persisted", async (t) => {
    // supplier-service returns 404 for both on its public endpoint
    useSupplierService(t, () => Response.json({ error: "Supplier not found" }, { status: 404 }));
    const { create } = capturePersisted(t);

    await assert.rejects(createErrand(input), isError(SupplierNotFoundError));
    assert.equal(create.mock.callCount(), 0);
  });

  test("supplier-service errors, network failures and malformed responses mean unavailable", async (t) => {
    const responses: (() => Response)[] = [
      () => Response.json({ error: "boom" }, { status: 500 }),
      () => { throw new TypeError("fetch failed"); },
      () => { throw new DOMException("The operation was aborted due to timeout", "TimeoutError"); },
      () => new Response("<html>not json</html>", { status: 200 }),
      () => Response.json({ supplier: {} }),
    ];
    let next = 0;
    useSupplierService(t, () => responses[next++]());
    const { create } = capturePersisted(t);

    for (let i = 0; i < responses.length; i++) {
      await assert.rejects(createErrand(input), isError(SupplierUnavailableError), `response #${i}`);
    }
    assert.equal(create.mock.callCount(), 0);
  });

  test("propagates database errors", async (t) => {
    useSupplierService(t, () => Response.json(supplierBody));
    const failure = new Error("database unavailable");
    t.mock.method(Errand, "create", (async () => { throw failure; }) as never);
    await assert.rejects(createErrand(input), (error) => error === failure);
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
    const { deliverBy, ...set } = calls[0].update.$set;
    assert.deepEqual(set, { status: "PICKED_UP" });
    assertWithin(deliverBy, before + DELIVERY_DEADLINE, after + DELIVERY_DEADLINE);
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

    const { deliverBy, ...filter } = calls[0].filter as { deliverBy: { $gt: Date } };
    assert.deepEqual(filter, { _id: ERRAND_ID, status: "PICKED_UP", courierId: COURIER_ID });
    assertWithin(deliverBy.$gt, before, after);
    const { confirmBy, ...set } = calls[0].update.$set;
    assert.deepEqual(set, { status: "PENDING_COMPLETION" });
    assertWithin(confirmBy, before + CONFIRMATION_DEADLINE, after + CONFIRMATION_DEADLINE);
  });

  test("assigned courier delivering after the completion deadline is told the deadline passed", async (t) => {
    mockUpdate(t, null, makeErrand({ status: "PICKED_UP", courierId: COURIER_ID, deliverBy: new Date(Date.now() - 1000) }));
    await assert.rejects(deliverErrand(ERRAND_ID, COURIER_ID), isError(DeliveryDeadlinePassedError));
  });

  test("another courier is not told about the deadline", async (t) => {
    mockUpdate(t, null, makeErrand({ status: "PICKED_UP", courierId: "courier-2", deliverBy: new Date(Date.now() - 1000) }));
    await assert.rejects(deliverErrand(ERRAND_ID, COURIER_ID), isError(UpdateConflictError));
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
    assert.deepEqual(calls[0].update, { $set: { status: "COMPLETED", eventPending: true } });
  });

  test("a publish failure after commit does not fail the request or clear the pending flag", async (t) => {
    t.mock.method(console, "error", () => {});
    setEventPublisher({ isReady: () => true, publish: async () => { throw new Error("broker down"); }, close: async () => {} });
    const completed = makeErrand({ status: "COMPLETED", courierId: COURIER_ID });
    mockUpdate(t, completed);
    const clearFlag = t.mock.method(Errand, "updateOne", (async () => ({ acknowledged: true })) as never);

    assert.equal(await completeErrand(ERRAND_ID, REQUESTER_ID), completed);
    assert.equal(clearFlag.mock.callCount(), 0);
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
    assert.deepEqual(calls[0].update, { $set: { status: "CANCELLED", eventPending: true } });
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
});
