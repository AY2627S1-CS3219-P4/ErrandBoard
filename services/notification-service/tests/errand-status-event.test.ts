import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { InvalidStatusEventError, parseStatusEvent } from "../src/event/errand-status-event.js";

const ID = "a".repeat(24);
const REQ = "1".repeat(24);
const COU = "2".repeat(24);

function valid(): any {
  return {
    key: ID,
    value: {
      eventId: `${ID}:status:ACCEPTED`, type: "errand.status.changed", errandId: ID, status: "ACCEPTED", previousStatus: "OPEN",
      actor: { role: "COURIER", userId: COU }, requesterId: REQ, courierId: COU, credit: 5, supplierName: "Fine Food", dropoff: "COM1",
      deadline: null, occurredAt: "2026-11-03T08:00:00.000Z",
    },
  };
}
const msg = (body: unknown, messageId: string | undefined = (body as any)?.value?.eventId) =>
  ({ content: Buffer.from(typeof body === "string" ? body : JSON.stringify(body)), properties: { messageId } }) as never;

describe("parseStatusEvent", () => {
  test("accepts a well-formed event", () => assert.equal(parseStatusEvent(msg(valid())).value.status, "ACCEPTED"));

  test("accepts a system actor with a null user id and an unassigned errand", () => {
    const e = valid();
    e.value.status = "EXPIRED"; e.value.previousStatus = "OPEN"; e.value.eventId = `${ID}:status:EXPIRED`;
    e.value.actor = { role: "SYSTEM", userId: null }; e.value.courierId = null;
    assert.equal(parseStatusEvent(msg(e)).value.status, "EXPIRED");
  });

  describe("disputes", () => {
    const base = (status: string, previous: string, actor: unknown) => {
      const e = valid();
      e.value.status = status; e.value.previousStatus = previous; e.value.eventId = `${ID}:status:${status}`; e.value.actor = actor;
      return e;
    };
    for (const previous of ["ACCEPTED", "PICKED_UP", "PENDING_COMPLETION"]) {
      test(`accepts ${previous} -> DISPUTED raised by the requester`, () => {
        const e = base("DISPUTED", previous, { role: "REQUESTER", userId: REQ });
        assert.equal(parseStatusEvent(msg(e, `${ID}:status:DISPUTED`)).value.status, "DISPUTED");
      });
    }
    test("accepts the sweep's PICKED_UP -> DISPUTED", () => {
      const e = base("DISPUTED", "PICKED_UP", { role: "SYSTEM", userId: null });
      assert.equal(parseStatusEvent(msg(e, `${ID}:status:DISPUTED`)).value.actor.role, "SYSTEM");
    });
    for (const status of ["CANCELLED", "COMPLETED"]) {
      test(`accepts an admin resolving DISPUTED -> ${status}`, () => {
        const e = base(status, "DISPUTED", { role: "ADMIN", userId: "3".repeat(24) });
        assert.equal(parseStatusEvent(msg(e, `${ID}:status:${status}`)).value.actor.role, "ADMIN");
      });
    }
    test("still accepts PICKED_UP -> CANCELLED from an Order Service that predates disputes", () => {
      const e = base("CANCELLED", "PICKED_UP", { role: "SYSTEM", userId: null });
      assert.equal(parseStatusEvent(msg(e, `${ID}:status:CANCELLED`)).value.status, "CANCELLED");
    });
    test("an admin must carry a user id", () => {
      const e = base("CANCELLED", "DISPUTED", { role: "ADMIN", userId: null });
      assert.throws(() => parseStatusEvent(msg(e, `${ID}:status:CANCELLED`)), InvalidStatusEventError);
    });
    test("rejects a transition out of DISPUTED that the Order Service does not allow", () => {
      const e = base("PICKED_UP", "DISPUTED", { role: "ADMIN", userId: "3".repeat(24) });
      assert.throws(() => parseStatusEvent(msg(e, `${ID}:status:PICKED_UP`)), InvalidStatusEventError);
    });
  });

  const mutations: [string, (e: any) => void][] = [
    ["non-object courierId", (e) => { e.value.courierId = 7; }],
    ["wrong event type", (e) => { e.value.type = "errand.completed"; }],
    ["key that is not an errand id", (e) => { e.key = "nope"; }],
    ["errandId differing from key", (e) => { e.value.errandId = "b".repeat(24); }],
    ["unknown status", (e) => { e.value.status = "TELEPORTED"; }],
    ["impossible transition", (e) => { e.value.previousStatus = "COMPLETED"; }],
    ["eventId that does not match key+status", (e) => { e.value.eventId = `${ID}:status:PICKED_UP`; }],
    ["system actor carrying a user id", (e) => { e.value.actor = { role: "SYSTEM", userId: COU }; }],
    ["human actor without a user id", (e) => { e.value.actor = { role: "COURIER", userId: null }; }],
    ["requester equal to courier", (e) => { e.value.courierId = REQ; }],
    ["non-positive credit", (e) => { e.value.credit = 0; }],
    ["fractional credit", (e) => { e.value.credit = 1.5; }],
    ["empty supplier name", (e) => { e.value.supplierName = ""; }],
    ["oversized dropoff", (e) => { e.value.dropoff = "x".repeat(201); }],
    ["bad deadline", (e) => { e.value.deadline = "tomorrow-ish"; }],
    ["bad occurredAt", (e) => { e.value.occurredAt = "soon"; }],
    ["missing value", (e) => { delete e.value; }],
  ];
  for (const [name, mutate] of mutations) {
    test(`rejects ${name}`, () => {
      const e = valid(); mutate(e);
      assert.throws(() => parseStatusEvent(msg(e, `${ID}:status:ACCEPTED`)), InvalidStatusEventError);
    });
  }

  test("rejects a messageId that disagrees with the body", () =>
    assert.throws(() => parseStatusEvent(msg(valid(), "something-else")), InvalidStatusEventError));
  test("rejects non-JSON", () => assert.throws(() => parseStatusEvent(msg("{not json", "x")), InvalidStatusEventError));
  test("rejects JSON null", () => assert.throws(() => parseStatusEvent(msg("null", "x")), InvalidStatusEventError));
});
