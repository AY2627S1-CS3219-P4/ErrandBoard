import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { planNotifications } from "../src/domain/notification-rules.js";
import type { StatusChangeEvent } from "../src/event/errand-status-event.js";

const ERRAND = "a".repeat(24);
const REQ = "1".repeat(24);
const COU = "2".repeat(24);

function ev(over: Partial<StatusChangeEvent["value"]>): StatusChangeEvent["value"] {
  return {
    eventId: `${ERRAND}:status:ACCEPTED`, type: "errand.status.changed", errandId: ERRAND, status: "ACCEPTED", previousStatus: "OPEN",
    actor: { role: "COURIER", userId: COU }, requesterId: REQ, courierId: COU, credit: 5, supplierName: "Fine Food", dropoff: "COM1 lobby",
    deadline: null, occurredAt: "2026-11-03T08:00:00.000Z", ...over,
  };
}
const on = { directActions: true };
const plan = (over: Partial<StatusChangeEvent["value"]>, opts = on) => planNotifications(ev(over), opts);
const summary = (over: Partial<StatusChangeEvent["value"]>) => plan(over).map((n) => `${n.recipientRole}:${n.kind}`);

describe("who is told about each transition", () => {
  test("accept -> requester only (the courier did it)", () => assert.deepEqual(summary({}), ["REQUESTER:ERRAND_ACCEPTED"]));
  test("pickup -> requester only", () => assert.deepEqual(summary({ status: "PICKED_UP", previousStatus: "ACCEPTED" }), ["REQUESTER:ERRAND_PICKED_UP"]));
  test("delivered -> requester only", () =>
    assert.deepEqual(summary({ status: "PENDING_COMPLETION", previousStatus: "PICKED_UP" }), ["REQUESTER:ERRAND_DELIVERED"]));

  test("requester confirms -> courier only", () =>
    assert.deepEqual(summary({ status: "COMPLETED", previousStatus: "PENDING_COMPLETION", actor: { role: "REQUESTER", userId: REQ } }), ["COURIER:ERRAND_COMPLETED"]));

  test("auto-completion by the sweep -> both are told, differently", () =>
    assert.deepEqual(
      summary({ status: "COMPLETED", previousStatus: "PENDING_COMPLETION", actor: { role: "SYSTEM", userId: null } }),
      ["COURIER:ERRAND_COMPLETED", "REQUESTER:ERRAND_AUTO_COMPLETED"],
    ));

  test("courier cancels an accepted errand -> requester only", () =>
    assert.deepEqual(summary({ status: "CANCELLED", previousStatus: "ACCEPTED" }), ["REQUESTER:ERRAND_CANCELLED_BY_COURIER"]));

  test("requester cancelling their own OPEN errand -> nobody", () =>
    assert.deepEqual(summary({ status: "CANCELLED", previousStatus: "OPEN", courierId: null, actor: { role: "REQUESTER", userId: REQ } }), []));

  test("delivery deadline missed (sweep) -> both", () =>
    assert.deepEqual(
      summary({ status: "CANCELLED", previousStatus: "PICKED_UP", actor: { role: "SYSTEM", userId: null } }),
      ["REQUESTER:ERRAND_CANCELLED_TIMEOUT", "COURIER:ERRAND_CANCELLED_TIMEOUT"],
    ));

  test("nobody accepted in time -> requester only, and no courier is required", () =>
    assert.deepEqual(summary({ status: "EXPIRED", previousStatus: "OPEN", courierId: null, actor: { role: "SYSTEM", userId: null } }), ["REQUESTER:ERRAND_EXPIRED"]));

  test("courier-targeted messages are skipped when there is no courier", () =>
    assert.deepEqual(summary({ status: "COMPLETED", previousStatus: "PENDING_COMPLETION", courierId: null, actor: { role: "SYSTEM", userId: null } }), ["REQUESTER:ERRAND_AUTO_COMPLETED"]));

  test("the acting user is never notified, whatever the rules produced", () => {
    // contrived: the requester is also the recorded actor of an accept
    assert.deepEqual(summary({ actor: { role: "COURIER", userId: REQ } }), []);
  });

  test("recipients are addressed by user id", () => {
    const [n] = plan({});
    assert.equal(n.recipientId, REQ);
  });
});

describe("interactive actions", () => {
  const delivered = { status: "PENDING_COMPLETION" as const, previousStatus: "PICKED_UP" as const };

  test("'delivered' offers one-tap confirm first, then view, and is high urgency", () => {
    const [n] = plan({ ...delivered, deadline: "2026-11-05T08:00:00.000Z" });
    assert.equal(n.urgency, "high");
    assert.deepEqual(n.actions.map((a) => a.action), ["confirm", "view"]);
    assert.deepEqual(n.actions[0].request, { method: "POST", path: `/errands/${ERRAND}/complete` });
    assert.equal(n.actions[1].request, undefined);
  });

  test("NOTIFY_DIRECT_ACTIONS=false removes the money-moving button but keeps view", () => {
    const [n] = plan(delivered, { directActions: false });
    assert.deepEqual(n.actions.map((a) => a.action), ["view"]);
  });

  test("every other notification is normal urgency with just a view action", () => {
    for (const n of [...plan({}), ...plan({ status: "PICKED_UP", previousStatus: "ACCEPTED" })]) {
      assert.equal(n.urgency, "normal");
      assert.deepEqual(n.actions.map((a) => a.action), ["view"]);
    }
  });
});

describe("message text", () => {
  test("states the confirm window without clock times (timezone-free)", () => {
    const [n] = plan({ status: "PENDING_COMPLETION", previousStatus: "PICKED_UP", deadline: "2026-11-05T08:00:00.000Z" });
    assert.match(n.body, /within 2 days/);
    assert.match(n.body, /release 5 credits/);
  });

  test("short windows are stated in hours, and a missing deadline is omitted", () => {
    const [hours] = plan({ status: "PENDING_COMPLETION", previousStatus: "PICKED_UP", deadline: "2026-11-03T14:00:00.000Z" });
    assert.match(hours.body, /within 6 hours/);
    const [none] = plan({ status: "PENDING_COMPLETION", previousStatus: "PICKED_UP", deadline: null });
    assert.doesNotMatch(none.body, /within/);
  });

  test("pluralises credits", () => {
    assert.match(plan({ status: "EXPIRED", previousStatus: "OPEN", credit: 1, actor: { role: "SYSTEM", userId: null } })[0].body, /1 credit are/);
    assert.match(plan({ status: "EXPIRED", previousStatus: "OPEN", credit: 3, actor: { role: "SYSTEM", userId: null } })[0].body, /3 credits are/);
  });
});
