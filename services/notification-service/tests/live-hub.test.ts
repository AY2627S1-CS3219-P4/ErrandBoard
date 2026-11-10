import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { LiveHub } from "../src/services/live-hub.js";
import { FakeSse, view } from "./fakes.js";

const hub = (o: Partial<ConstructorParameters<typeof LiveHub>[0]> = {}) =>
  new LiveHub({ heartbeatMs: 60_000, maxAgeMs: 60_000, maxPerUser: 3, ...o });

describe("LiveHub", () => {
  test("opens an SSE stream with the right headers, retry hint and ready event", () => {
    const h = hub(); const s = new FakeSse();
    h.subscribe("u1", s.res);
    assert.equal(s.statusCode, 200);
    assert.equal(s.headers["Content-Type"], "text/event-stream");
    assert.equal(s.headers["X-Accel-Buffering"], "no");
    assert.match(s.text, /^retry: 3000\n\nevent: ready/);
    s.end();
  });

  test("publish writes an id'd notification event only to that user's streams", () => {
    const h = hub(); const a1 = new FakeSse(), a2 = new FakeSse(), b = new FakeSse();
    h.subscribe("a", a1.res); h.subscribe("a", a2.res); h.subscribe("b", b.res);
    const n = view();
    assert.equal(h.publish("a", n), 2);
    for (const s of [a1, a2]) assert.ok(s.text.includes(`id: ${n.id}\nevent: notification\ndata: ${JSON.stringify(n)}\n\n`));
    assert.ok(!b.text.includes("notification\ndata"));
    for (const s of [a1, a2, b]) s.end();
  });

  test("publish to a user with no open stream is a harmless no-op", () => assert.equal(hub().publish("ghost", view()), 0));

  test("replay writes catch-up items in order", () => {
    const h = hub(); const s = new FakeSse(); h.subscribe("u", s.res);
    const [n1, n2] = [view({ title: "one" }), view({ title: "two" })];
    h.replay(s.res, [n1, n2]);
    assert.ok(s.text.indexOf("one") < s.text.indexOf("two"));
    s.end();
  });

  test("closing a stream removes it, and the user entry once empty", () => {
    const h = hub(); const s = new FakeSse(); h.subscribe("u", s.res);
    assert.equal(h.connectionCount("u"), 1);
    s.end();
    assert.equal(h.connectionCount("u"), 0);
    assert.equal(h.connectionCount(), 0);
  });

  test("never writes to an ended stream", () => {
    const h = hub(); const s = new FakeSse(); h.subscribe("u", s.res);
    s.writable = false;
    assert.equal(h.publish("u", view()), 0);
    s.end();
  });

  test("evicts the oldest stream beyond the per-user cap", () => {
    const h = hub({ maxPerUser: 2 }); const [s1, s2, s3] = [new FakeSse(), new FakeSse(), new FakeSse()];
    h.subscribe("u", s1.res); h.subscribe("u", s2.res); h.subscribe("u", s3.res);
    assert.equal(s1.writableEnded, true);
    assert.equal(h.connectionCount("u"), 2);
    s2.end(); s3.end();
  });

  test("streams expire on their own so reconnects re-authenticate", async () => {
    const h = hub({ maxAgeMs: 20 }); const s = new FakeSse(); h.subscribe("u", s.res);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(s.writableEnded, true);
    assert.equal(h.connectionCount(), 0);
  });

  test("sends keep-alive comments", async () => {
    const h = hub({ heartbeatMs: 10 }); const s = new FakeSse(); h.subscribe("u", s.res);
    await new Promise((r) => setTimeout(r, 40));
    assert.ok(s.text.includes(": keep-alive"));
    s.end();
  });

  test("closeAll ends every stream (so server.close can finish)", () => {
    const h = hub(); const [a, b] = [new FakeSse(), new FakeSse()];
    h.subscribe("a", a.res); h.subscribe("b", b.res);
    h.closeAll();
    assert.deepEqual([a.writableEnded, b.writableEnded], [true, true]);
    assert.equal(h.connectionCount(), 0);
  });
});
