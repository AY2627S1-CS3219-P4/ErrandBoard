import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test, type TestContext } from "node:test";
import { Errand, type ErrandRecord } from "../src/models/Errand.js";
import { setEventPublisher } from "../src/event/publisher.js";
import type { ErrandEvent } from "../src/event/types.js";
import type { ErrandStatus } from "../src/status/errandState.js";
import { runLifecycleSweep } from "../src/queue/sweep.js";

// mirrors the constant in sweep.ts
const SWEEP_BATCH = 200;

// updateErrand rejects anything that is not a 24-char hex ObjectId, so due ids must look real
const OPEN_ID = "507f1f77bcf86cd799439011";
const PICKED_ID = "507f1f77bcf86cd799439012";
const PENDING_ID = "507f1f77bcf86cd799439013";
const BAD_ID = "507f1f77bcf86cd7994390b1";
const GOOD_ID = "507f1f77bcf86cd7994390c2";

// overrides are intentionally loose so tests can use plain string ids in place of ObjectId
function makeErrand(overrides: Record<string, unknown> = {}): ErrandRecord {
  return {
    _id: "507f1f77bcf86cd799439011",
    requesterId: "requester-1",
    courierId: "courier-1",
  supplier: { supplierId: "supplier-1", name: "Fine Food", building: "Town Plaza", address: "1 Create Way" },
    dropoff: "COM1 lobby",
    description: "Chicken rice",
    credit: 5,
    status: "OPEN",
    expiresAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as ErrandRecord;
}

type FindCall = { query: Record<string, unknown>; select?: unknown; limit?: unknown };

// mocks Errand.find(...).select("_id").limit(n).lean(), returning the due docs registered per status
function mockDueFind(t: TestContext, byStatus: Partial<Record<ErrandStatus, { _id: string }[]>>) {
  const calls: FindCall[] = [];
  t.mock.method(Errand, "find", ((query: Record<string, unknown>) => {
    const call: FindCall = { query };
    calls.push(call);
    const results = byStatus[query.status as ErrandStatus] ?? [];
    const chain = {
      select(fields: unknown) { call.select = fields; return chain; },
      limit(n: unknown) { call.limit = n; return chain; },
      lean() { return Promise.resolve(results); },
    };
    return chain;
  }) as never);
  return calls;
}

type UpdateCall = { filter: Record<string, unknown>; update: { $set: Record<string, unknown> } };

// mocks the atomic transition. `decide` returns the updated doc (success) or null (lost CAS race) per call.
function mockTransition(
  t: TestContext,
  decide: (filter: Record<string, unknown>, update: UpdateCall["update"]) => ErrandRecord | null,
) {
  const calls: UpdateCall[] = [];
  t.mock.method(Errand, "findOneAndUpdate", (async (filter: Record<string, unknown>, update: UpdateCall["update"]) => {
    calls.push({ filter, update });
    return decide(filter, update);
  }) as never);
  // updateErrand looks the errand up again when the update matched nothing
  t.mock.method(Errand, "findById", (async () => null) as never);
  return calls;
}

function assertDueDate(value: unknown, before: number, after: number) {
  const due = (value as { $lte: Date }).$lte;
  assert.ok(due instanceof Date, "expected a $lte Date filter");
  assert.ok(due.getTime() >= before && due.getTime() <= after, "sweep should use the current time");
}

describe("runLifecycleSweep", () => {
  let published: ErrandEvent[];

  beforeEach(() => {
    published = [];
    setEventPublisher({ isReady: () => true, publish: async (e) => { published.push(e); }, close: async () => {} });
  });
  afterEach(() => setEventPublisher(undefined));

  test("queries each status by its own deadline field, selecting only ids up to the batch limit", async (t) => {
    const finds = mockDueFind(t, {});
    mockTransition(t, () => null);

    const before = Date.now();
    await runLifecycleSweep();
    const after = Date.now();

    assert.equal(finds.length, 3);
    const byStatus = Object.fromEntries(finds.map((c) => [c.query.status, c]));

    assertDueDate(byStatus.OPEN.query.expiresAt, before, after);
    assertDueDate(byStatus.PICKED_UP.query.deliverBy, before, after);
    assertDueDate(byStatus.PENDING_COMPLETION.query.confirmBy, before, after);

    for (const call of finds) {
      assert.equal(call.select, "_id");
      assert.equal(call.limit, SWEEP_BATCH);
    }
  });

  test("transitions every due errand and publishes its terminal event", async (t) => {
    mockDueFind(t, {
      OPEN: [{ _id: OPEN_ID }],
      PICKED_UP: [{ _id: PICKED_ID }],
      PENDING_COMPLETION: [{ _id: PENDING_ID }],
    });
    // echo the requested transition back as the updated document, now carrying the target status
    const updates = mockTransition(t, (filter, update) =>
      makeErrand({ _id: filter._id as string, status: update.$set.status as ErrandStatus }));

    await runLifecycleSweep();

    // the updated doc carries the target status, so its event type follows the $set, not the matched status
    const byId = Object.fromEntries(updates.map((c) => [c.filter._id, c]));
    assert.deepEqual(byId[OPEN_ID].filter.status, "OPEN");
    assert.deepEqual(byId[OPEN_ID].update.$set.status, "EXPIRED");
    assert.deepEqual(byId[PICKED_ID].filter.status, "PICKED_UP");
    assert.deepEqual(byId[PICKED_ID].update.$set.status, "CANCELLED");
    assert.deepEqual(byId[PENDING_ID].filter.status, "PENDING_COMPLETION");
    assert.deepEqual(byId[PENDING_ID].update.$set.status, "COMPLETED");

    assert.deepEqual(
      published.map((e) => e.value.type).sort(),
      ["errand.cancelled", "errand.completed", "errand.expired"],
    );
  });

  test("a failing transition is skipped and does not stop the sweep", async (t) => {
    t.mock.method(console, "warn", () => {}); // silence the per-item warning
    mockDueFind(t, { OPEN: [{ _id: BAD_ID }, { _id: GOOD_ID }] });
    // BAD_ID matches nothing (findById also null -> ErrandNotFoundError); GOOD_ID succeeds
    const updates = mockTransition(t, (filter) =>
      filter._id === GOOD_ID ? makeErrand({ _id: GOOD_ID, status: "EXPIRED" }) : null);

    await assert.doesNotReject(runLifecycleSweep());

    assert.deepEqual(updates.map((c) => c.filter._id), [BAD_ID, GOOD_ID]);
    assert.equal(published.length, 1);
    assert.equal(published[0].value.type, "errand.expired");
  });

  test("does nothing when no errands are due", async (t) => {
    mockDueFind(t, {});
    const updates = mockTransition(t, () => makeErrand());

    await runLifecycleSweep();

    assert.equal(updates.length, 0);
    assert.equal(published.length, 0);
  });
});
