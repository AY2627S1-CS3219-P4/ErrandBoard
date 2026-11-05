import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test, type TestContext } from "node:test";
import type { ChannelWrapper } from "amqp-connection-manager";
import { Errand, type ErrandRecord, type StatusOutboxEntry } from "../src/models/Errand.js";
import { setEventPublisher } from "../src/event/publisher.js";
import { RabbitPublisher } from "../src/event/rabbit.publisher.js";
import { buildStatusEvent, flushPendingStatusEvents, publishStatusEvents, statusEventId } from "../src/event/status.events.js";
import { STATUS_EVENT_TYPE, type PublishableEvent, type StatusChangeEvent } from "../src/event/types.js";
import {
  acceptErrand,
  cancelErrandByCourier,
  completeErrand,
  deliverErrand,
  expireOpenErrand,
  pickUpErrand,
} from "../src/services/order.services.js";

const ERRAND_ID = "507f1f77bcf86cd799439011";
const REQUESTER_ID = "requester-1";
const COURIER_ID = "courier-1";

function entry(status: StatusOutboxEntry["status"], overrides: Partial<StatusOutboxEntry> = {}): StatusOutboxEntry {
  return {
    eventId: statusEventId(ERRAND_ID, status),
    status,
    previousStatus: "OPEN",
    actorRole: "COURIER",
    actorId: COURIER_ID,
    at: new Date("2026-11-03T08:00:00.000Z"),
    ...overrides,
  };
}

function makeErrand(overrides: Record<string, unknown> = {}): ErrandRecord {
  return {
    _id: ERRAND_ID,
    requesterId: REQUESTER_ID,
    courierId: COURIER_ID,
    supplier: { supplierId: "s-1", name: "Fine Food", building: "Town Plaza", address: "1 Create Way" },
    dropoff: "COM1 lobby",
    description: "Chicken rice, no chilli",
    credit: 5,
    status: "ACCEPTED",
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as ErrandRecord;
}

let published: PublishableEvent[];
let writes: { filter: Record<string, unknown>; update: Record<string, any>; options: unknown }[];

beforeEach(() => {
  published = [];
  setEventPublisher({ isReady: () => true, publish: async (e) => { published.push(e); }, close: async () => {} });
});
afterEach(() => setEventPublisher(undefined));

// records every Errand.updateOne (outbox $pull / flag $unset) and the findOneAndUpdate transition
function mockDb(t: TestContext, updated: ErrandRecord | null) {
  writes = [];
  const transitions: { filter: Record<string, unknown>; update: Record<string, any> }[] = [];
  t.mock.method(Errand, "findOneAndUpdate", (async (filter: Record<string, unknown>, update: Record<string, any>) => {
    transitions.push({ filter, update });
    return updated;
  }) as never);
  t.mock.method(Errand, "findById", (async () => null) as never);
  t.mock.method(Errand, "updateOne", (async (filter: Record<string, unknown>, update: Record<string, any>, options: unknown) => {
    writes.push({ filter, update, options });
    return { acknowledged: true };
  }) as never);
  return transitions;
}

const statusEvents = () => published.filter((e): e is StatusChangeEvent => e.value.type === STATUS_EVENT_TYPE);

describe("outbox entry is written atomically with the transition", () => {
  test("accept pushes an outbox entry attributed to the courier and flags notifyPending", async (t) => {
    const transitions = mockDb(t, makeErrand({ status: "ACCEPTED" }));
    await acceptErrand(ERRAND_ID, COURIER_ID);

    const { $set, $push } = transitions[0].update;
    assert.equal($set.notifyPending, true);
    assert.equal($push.notifyOutbox.eventId, statusEventId(ERRAND_ID, "ACCEPTED"));
    assert.equal($push.notifyOutbox.status, "ACCEPTED");
    assert.equal($push.notifyOutbox.previousStatus, "OPEN");
    assert.equal($push.notifyOutbox.actorRole, "COURIER");
    assert.equal($push.notifyOutbox.actorId, COURIER_ID);
    assert.ok($push.notifyOutbox.at instanceof Date);
    assert.equal($push.notifyOutbox.deadline, undefined);
  });

  test("pickup and deliver record the deadline they set", async (t) => {
    const picked = mockDb(t, makeErrand({ status: "PICKED_UP" }));
    await pickUpErrand(ERRAND_ID, COURIER_ID);
    assert.ok(picked[0].update.$push.notifyOutbox.deadline instanceof Date);
    assert.equal(picked[0].update.$push.notifyOutbox.deadline, picked[0].update.$set.deliverBy);
  });

  test("deliver records confirmBy as the deadline", async (t) => {
    const delivered = mockDb(t, makeErrand({ status: "PENDING_COMPLETION" }));
    await deliverErrand(ERRAND_ID, COURIER_ID);
    assert.equal(delivered[0].update.$push.notifyOutbox.deadline, delivered[0].update.$set.confirmBy);
  });

  test("requester and courier actions are attributed correctly; sweep transitions are SYSTEM", async (t) => {
    let transitions = mockDb(t, makeErrand({ status: "COMPLETED" }));
    await completeErrand(ERRAND_ID, REQUESTER_ID);
    assert.deepEqual(
      [transitions[0].update.$push.notifyOutbox.actorRole, transitions[0].update.$push.notifyOutbox.actorId],
      ["REQUESTER", REQUESTER_ID],
    );

    transitions = mockDb(t, makeErrand({ status: "CANCELLED" }));
    await cancelErrandByCourier(ERRAND_ID, COURIER_ID);
    assert.equal(transitions[0].update.$push.notifyOutbox.actorRole, "COURIER");

    transitions = mockDb(t, makeErrand({ status: "EXPIRED" }));
    await expireOpenErrand(ERRAND_ID);
    assert.equal(transitions[0].update.$push.notifyOutbox.actorRole, "SYSTEM");
    assert.equal("actorId" in transitions[0].update.$push.notifyOutbox, false);
  });

  test("a lost race (update matched nothing) publishes nothing", async (t) => {
    const transitions = mockDb(t, null);
    await assert.rejects(acceptErrand(ERRAND_ID, COURIER_ID)); // findOneAndUpdate matched nothing, errand missing
    assert.equal(published.length, 0);
    assert.equal(transitions.length, 1);
  });
});

describe("publishing and draining the outbox", () => {
  test("a transition publishes a status event, then removes exactly that entry and clears the flag", async (t) => {
    const updated = makeErrand({ status: "ACCEPTED", notifyOutbox: [entry("ACCEPTED")] });
    mockDb(t, updated);

    await acceptErrand(ERRAND_ID, COURIER_ID);

    assert.equal(statusEvents().length, 1);
    const ev = statusEvents()[0];
    assert.equal(ev.key, ERRAND_ID);
    assert.deepEqual(ev.value, {
      eventId: `${ERRAND_ID}:status:ACCEPTED`,
      type: "errand.status.changed",
      errandId: ERRAND_ID,
      status: "ACCEPTED",
      previousStatus: "OPEN",
      actor: { role: "COURIER", userId: COURIER_ID },
      requesterId: REQUESTER_ID,
      courierId: COURIER_ID,
      credit: 5,
      supplierName: "Fine Food",
      dropoff: "COM1 lobby",
      deadline: null,
      occurredAt: "2026-11-03T08:00:00.000Z",
    });

    assert.deepEqual(writes[0].update, { $pull: { notifyOutbox: { eventId: { $in: [ev.value.eventId] } } } });
    assert.deepEqual(writes[0].options, { timestamps: false });
    assert.deepEqual(writes[1].update, { $unset: { notifyPending: "" } });
    // guarded so a concurrent transition that just pushed a new entry keeps its flag
    assert.ok(JSON.stringify(writes[1].filter).includes("$size"));
    assert.deepEqual(writes[1].options, { timestamps: false });
  });

  test("a terminal transition emits BOTH the settlement event and the status event", async (t) => {
    mockDb(t, makeErrand({ status: "COMPLETED", notifyOutbox: [entry("COMPLETED", { previousStatus: "PENDING_COMPLETION" })] }));
    await completeErrand(ERRAND_ID, REQUESTER_ID);
    assert.deepEqual(published.map((e) => e.value.type).sort(), ["errand.completed", "errand.status.changed"]);
  });

  test("a publish failure never fails the request and leaves the entry in the outbox", async (t) => {
    t.mock.method(console, "error", () => {});
    setEventPublisher({ isReady: () => true, publish: async () => { throw new Error("broker down"); }, close: async () => {} });
    const updated = makeErrand({ status: "ACCEPTED", notifyOutbox: [entry("ACCEPTED")] });
    mockDb(t, updated);

    assert.equal(await acceptErrand(ERRAND_ID, COURIER_ID), updated);
    assert.equal(writes.length, 0, "nothing may be $pulled or unflagged");
  });

  test("entries publish in order and stop at the first failure (per-errand ordering)", async (t) => {
    t.mock.method(console, "error", () => {});
    const seen: string[] = [];
    setEventPublisher({
      isReady: () => true,
      publish: async (e) => { if (e.value.eventId.endsWith("PICKED_UP")) throw new Error("nack"); seen.push(e.value.eventId); },
      close: async () => {},
    });
    mockDb(t, null);
    const errand = makeErrand({ notifyOutbox: [entry("ACCEPTED"), entry("PICKED_UP"), entry("PENDING_COMPLETION")] });

    assert.equal(await publishStatusEvents(errand), false);

    assert.deepEqual(seen, [`${ERRAND_ID}:status:ACCEPTED`]); // PENDING_COMPLETION never jumps the queue
    assert.deepEqual(writes.length, 1);
    assert.deepEqual(writes[0].update, { $pull: { notifyOutbox: { eventId: { $in: [`${ERRAND_ID}:status:ACCEPTED`] } } } });
  });

  test("when pulling confirmed entries fails, the failure is swallowed (consumer dedupes the repeat)", async (t) => {
    t.mock.method(console, "error", () => {});
    t.mock.method(Errand, "updateOne", (async () => { throw new Error("mongo down"); }) as never);
    assert.equal(await publishStatusEvents(makeErrand({ notifyOutbox: [entry("ACCEPTED")] })), false);
  });

  test("an errand with no entries publishes nothing and writes nothing", async (t) => {
    mockDb(t, null);
    assert.equal(await publishStatusEvents(makeErrand()), true);
    assert.equal(published.length + writes.length, 0);
  });
});

describe("flushPendingStatusEvents (sweep relay)", () => {
  function mockPending(t: TestContext, pending: ErrandRecord[]) {
    const queries: Record<string, unknown>[] = [];
    t.mock.method(Errand, "find", ((query: Record<string, unknown>) => {
      queries.push(query);
      const chain = { sort() { return chain; }, limit() { return Promise.resolve(pending); } };
      return chain;
    }) as never);
    return queries;
  }

  test("relays pending errands oldest-first and returns how many drained", async (t) => {
    mockDb(t, null);
    const queries = mockPending(t, [
      makeErrand({ _id: "507f1f77bcf86cd799439021", notifyOutbox: [entry("ACCEPTED", { eventId: "507f1f77bcf86cd799439021:status:ACCEPTED" })] }),
      makeErrand({ _id: "507f1f77bcf86cd799439022", notifyOutbox: [entry("PICKED_UP", { eventId: "507f1f77bcf86cd799439022:status:PICKED_UP" })] }),
    ]);

    assert.equal(await flushPendingStatusEvents(), 2);
    assert.deepEqual(queries, [{ notifyPending: true }]);
    assert.deepEqual(statusEvents().map((e) => e.key), ["507f1f77bcf86cd799439021", "507f1f77bcf86cd799439022"]);
  });

  test("stops the tick when the broker is down so the rest wait for the next one", async (t) => {
    t.mock.method(console, "error", () => {});
    setEventPublisher({ isReady: () => false, publish: async () => { throw new Error("down"); }, close: async () => {} });
    mockDb(t, null);
    mockPending(t, [makeErrand({ notifyOutbox: [entry("ACCEPTED")] }), makeErrand({ _id: "507f1f77bcf86cd799439022", notifyOutbox: [entry("ACCEPTED")] })]);
    assert.equal(await flushPendingStatusEvents(), 0);
    assert.equal(writes.length, 0);
  });

  test("clears a stale flag whose outbox is already empty", async (t) => {
    mockDb(t, null);
    mockPending(t, [makeErrand({ notifyPending: true, notifyOutbox: [] })]);
    await flushPendingStatusEvents();
    assert.equal(published.length, 0);
    assert.deepEqual(writes.map((w) => w.update), [{ $unset: { notifyPending: "" } }]);
  });

  test("warns about a backlog older than two minutes", async (t) => {
    const warn = t.mock.method(console, "warn", () => {});
    mockDb(t, null);
    mockPending(t, [makeErrand({ notifyOutbox: [entry("ACCEPTED", { at: new Date(Date.now() - 3 * 60_000) })] })]);
    await flushPendingStatusEvents();
    assert.equal(warn.mock.callCount(), 1);
  });
});

describe("buildStatusEvent", () => {
  test("uses the entry's own timestamp and carries the deadline as ISO", () => {
    const deadline = new Date("2026-11-05T08:00:00.000Z");
    const ev = buildStatusEvent(makeErrand(), entry("PICKED_UP", { deadline, at: new Date("2026-11-03T09:00:00.000Z") }));
    assert.equal(ev.value.deadline, "2026-11-05T08:00:00.000Z");
    assert.equal(ev.value.occurredAt, "2026-11-03T09:00:00.000Z");
  });

  test("system actions have a null actor id", () => {
    const ev = buildStatusEvent(makeErrand(), entry("EXPIRED", { actorRole: "SYSTEM", actorId: undefined }));
    assert.deepEqual(ev.value.actor, { role: "SYSTEM", userId: null });
  });

  test("an unassigned errand has a null courier", () => {
    const ev = buildStatusEvent(makeErrand({ courierId: undefined }), entry("EXPIRED"));
    assert.equal(ev.value.courierId, null);
  });
});

describe("RabbitPublisher with status events", () => {
  function publisherWithCalls() {
    const calls: { exchange: string; routingKey: string; options: Record<string, unknown> }[] = [];
    const channel = {
      publish: async (exchange: string, routingKey: string, _body: Buffer, options: Record<string, unknown>) => {
        calls.push({ exchange, routingKey, options });
        return true;
      },
    } as unknown as ChannelWrapper;
    return { publisher: new RabbitPublisher(channel, () => true, async () => {}), calls };
  }

  test("status events use their own routing key and are not mandatory", async () => {
    const { publisher, calls } = publisherWithCalls();
    await publisher.publish(buildStatusEvent(makeErrand(), entry("ACCEPTED")));
    assert.equal(calls[0].exchange, "errand.events");
    assert.equal(calls[0].routingKey, "errand.status.changed");
    assert.equal(calls[0].options.mandatory, false);
    assert.equal(calls[0].options.persistent, true);
    assert.equal(calls[0].options.messageId, `${ERRAND_ID}:status:ACCEPTED`);
  });

  test("settlement events remain mandatory", async () => {
    const { publisher, calls } = publisherWithCalls();
    await publisher.publish({
      key: ERRAND_ID,
      value: { eventId: `${ERRAND_ID}:errand.completed`, type: "errand.completed", requesterId: "r", courierId: "c", credit: 5, occurredAt: new Date().toISOString() },
    });
    assert.equal(calls[0].options.mandatory, true);
  });
});
