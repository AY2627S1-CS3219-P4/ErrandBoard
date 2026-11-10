import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import vm from "node:vm";

const SRC = readFileSync(new URL("../client/sw.js", import.meta.url), "utf8");
const ERRAND = "a".repeat(24);
// objects built inside the vm sandbox have a foreign prototype; normalise before deep-equal
const plain = (v: any) => JSON.parse(JSON.stringify(v));

/** Runs client/sw.js in a sandbox shaped like ServiceWorkerGlobalScope. */
function boot(opts: { maxActions?: number; windows?: any[]; fetchImpl?: (url: string, init: any) => Promise<any>; search?: string } = {}) {
  const handlers: Record<string, (e: any) => void> = {};
  const shown: { title: string; options: any }[] = [];
  const opened: string[] = [];
  const fetched: { url: string; init: any }[] = [];
  const badge: number[] = [];
  const windows = opts.windows ?? [];
  const self: any = {
    location: { href: `https://app.test/sw.js${opts.search ?? ""}`, origin: "https://app.test" },
    addEventListener: (t: string, fn: any) => { handlers[t] = fn; },
    skipWaiting: () => {},
    clients: { claim: async () => {}, matchAll: async () => windows, openWindow: async (u: string) => { opened.push(u); } },
    registration: { showNotification: async (title: string, options: any) => { shown.push({ title, options: plain(options) }); } },
    Notification: { maxActions: opts.maxActions ?? 2 },
    navigator: { setAppBadge: async (n: number) => { badge.push(n); } },
  };
  const ctx = vm.createContext({
    self, URL, Date, Number, JSON, Boolean, RegExp, Promise,
    fetch: async (url: string, init: any) => { fetched.push({ url, init }); return (opts.fetchImpl ?? (async () => ({ ok: true, status: 200 })))(url, init); },
  });
  vm.runInContext(SRC, ctx);

  const waits: Promise<unknown>[] = [];
  const fire = async (type: string, e: any) => { handlers[type]({ ...e, waitUntil: (p: Promise<unknown>) => waits.push(p) }); await Promise.all(waits.splice(0)); };
  const push = (payload: unknown) => fire("push", { data: { json: () => { if (payload === "BAD") throw new Error("x"); return payload; } } });
  const click = (action: string, data: any, closed = { n: 0 }) => fire("notificationclick", { action, notification: { data, close: () => { closed.n++; } } });
  return { shown, opened, fetched, badge, windows, push, click, fire };
}

const payload = (over: any = {}) => ({
  v: 1, id: "n1", tag: `errand-${ERRAND}`, title: "Delivered — please confirm", body: "…", url: `/errands/${ERRAND}`, errandId: ERRAND,
  urgency: "high", occurredAt: "2026-11-03T08:00:00.000Z", unread: 4,
  actions: [{ action: "confirm", title: "Confirm receipt", request: { method: "POST", path: `/errands/${ERRAND}/complete` } }, { action: "view", title: "View errand" }],
  ...over,
});
const clickData = (p = payload()) => ({ url: p.url, errandId: p.errandId, actions: p.actions });

describe("push display", () => {
  test("shows title/body with a per-errand tag, renotify, urgency and the unread badge", async () => {
    const sw = boot(); await sw.push(payload());
    const { title, options } = sw.shown[0];
    assert.equal(title, "Delivered — please confirm");
    assert.equal(options.tag, `errand-${ERRAND}`);
    assert.equal(options.renotify, true);
    assert.equal(options.requireInteraction, true);
    assert.deepEqual(sw.badge, [4]);
  });

  test("renders as many buttons as the browser supports, most useful first, without leaking the request", async () => {
    const two = boot({ maxActions: 2 }); await two.push(payload());
    assert.deepEqual(two.shown[0].options.actions, [{ action: "confirm", title: "Confirm receipt" }, { action: "view", title: "View errand" }]);
    const one = boot({ maxActions: 1 }); await one.push(payload());
    assert.deepEqual(one.shown[0].options.actions.map((a: any) => a.action), ["confirm"]);
    const none = boot({ maxActions: 0 }); await none.push(payload()); // Safari / iOS
    assert.deepEqual(none.shown[0].options.actions, []);
    assert.equal(none.shown[0].options.data.actions.length, 2, "full actions still travel in data for the click handler");
  });

  test("a normal-urgency update does not demand interaction", async () => {
    const sw = boot(); await sw.push(payload({ urgency: "normal" })); assert.equal(sw.shown[0].options.requireInteraction, false);
  });

  test("always shows SOMETHING, even for an unreadable or unknown payload (Safari revokes silent pushes)", async () => {
    const a = boot(); await a.push("BAD"); assert.equal(a.shown.length, 1);
    const b = boot(); await b.push({ v: 99 }); assert.equal(b.shown[0].title, "ErrandBoard");
  });

  test("tells open windows, and shows quietly rather than skipping when the app is focused", async () => {
    const posted: any[] = [];
    const win = { focused: true, visibilityState: "visible", url: "https://app.test/", postMessage: (m: any) => posted.push(m) };
    const sw = boot({ windows: [win] }); await sw.push(payload());
    assert.equal(posted[0].type, "notification");
    assert.equal(sw.shown[0].options.silent, true);
    const bg = boot({ windows: [{ ...win, focused: false, postMessage() {} }] }); await bg.push(payload());
    assert.equal(bg.shown[0].options.silent, false);
  });
});

describe("one-tap confirm (notification action)", () => {
  test("POSTs to the order API with the session cookie and confirms to the user", async () => {
    const sw = boot({ search: "?api=https://api.test" });
    await sw.click("confirm", clickData());
    assert.equal(sw.fetched[0].url, `https://api.test/errands/${ERRAND}/complete`);
    assert.equal(sw.fetched[0].init.method, "POST");
    assert.equal(sw.fetched[0].init.credentials, "include");
    assert.equal(sw.shown[0].title, "Receipt confirmed");
    assert.equal(sw.shown[0].options.tag, `errand-${ERRAND}`, "replaces the original notification");
    assert.deepEqual(sw.opened, [], "no need to open the app");
  });

  test("409 (already completed / auto-completed) is reported, not treated as a failure", async () => {
    const sw = boot({ fetchImpl: async () => ({ ok: false, status: 409 }) });
    await sw.click("confirm", clickData());
    assert.equal(sw.shown[0].title, "Already updated");
  });

  for (const status of [401, 403, 503]) {
    test(`${status} falls back to opening the app on the errand (and never refreshes the session)`, async () => {
      const sw = boot({ fetchImpl: async () => ({ ok: false, status }) });
      await sw.click("confirm", clickData());
      assert.deepEqual(sw.opened, [`https://app.test/errands/${ERRAND}`]);
      assert.equal(sw.fetched.length, 1, "exactly one request: no /auth/refresh");
    });
  }

  test("a network failure falls back to opening the app", async () => {
    const sw = boot({ fetchImpl: async () => { throw new Error("offline"); } });
    await sw.click("confirm", clickData());
    assert.equal(sw.opened.length, 1);
  });

  test("refuses to run any request outside the allowlist, even if a payload asks", async () => {
    for (const path of ["/errands/" + ERRAND + "/cancel", "/credit/me/balance", "/errands/../auth/logout", "https://evil.test/x", `/errands/${ERRAND}/complete/extra`]) {
      const sw = boot();
      const data = { url: "/errands/x", actions: [{ action: "confirm", title: "x", request: { method: "POST", path } }] };
      await sw.click("confirm", data);
      assert.equal(sw.fetched.length, 0, path);
    }
    const sw = boot();
    await sw.click("confirm", { url: "/", actions: [{ action: "confirm", title: "x", request: { method: "DELETE", path: `/errands/${ERRAND}/complete` } }] });
    assert.equal(sw.fetched.length, 0);
  });
});

describe("review & confirm (opens the app, nothing is sent)", () => {
  const review = { action: "review", title: "Review & confirm", url: `/errands/active?review=${ERRAND}` };
  const data = () => ({ url: "/errands/active", errandId: ERRAND, actions: [review, { action: "view", title: "View errand" }] });

  test("tapping the button opens ITS url (not the notification's), without calling any API", async () => {
    const sw = boot(); await sw.click("review", data());
    assert.deepEqual(sw.opened, [`https://app.test/errands/active?review=${ERRAND}`]);
    assert.equal(sw.fetched.length, 0);
  });

  test("an already-open tab is focused and routed to the review url", async () => {
    const posted: any[] = [];
    const win = { url: "https://app.test/home", focus: async () => {}, postMessage: (m: any) => posted.push(plain(m)) };
    const sw = boot({ windows: [win] }); await sw.click("review", data());
    assert.deepEqual(posted, [{ type: "navigate", url: `/errands/active?review=${ERRAND}` }]);
    assert.deepEqual(sw.opened, []);
  });

  test("the button is rendered like any other, without leaking its url into the visible action", async () => {
    const sw = boot({ maxActions: 2 });
    await sw.push(payload({ actions: data().actions }));
    assert.deepEqual(sw.shown[0].options.actions, [{ action: "review", title: "Review & confirm" }, { action: "view", title: "View errand" }]);
  });
});

describe("only same-origin app paths are ever opened", () => {
  for (const hostile of ["https://evil.test/phish", "//evil.test/phish", "javascript:alert(1)", "/\\evil.test", "evil.test", undefined, 42]) {
    test(`refuses ${String(hostile)}`, async () => {
      const sw = boot();
      await sw.click("", { url: hostile, actions: [] });
      assert.deepEqual(sw.opened, ["https://app.test/"]);
      const sw2 = boot();
      await sw2.click("review", { url: "/ok", actions: [{ action: "review", title: "x", url: hostile }] });
      assert.deepEqual(sw2.opened, [hostile === undefined ? "https://app.test/ok" : "https://app.test/"]);
    });
  }
});

describe("opening the app", () => {
  test("tapping the notification opens the errand and closes the notification", async () => {
    const closed = { n: 0 }; const sw = boot(); await sw.click("", clickData(), closed);
    assert.deepEqual(sw.opened, [`https://app.test/errands/${ERRAND}`]);
    assert.equal(closed.n, 1);
  });

  test("the 'view' button behaves like tapping the body", async () => {
    const sw = boot(); await sw.click("view", clickData());
    assert.equal(sw.opened.length, 1);
  });

  test("focuses an already-open tab and routes it, instead of opening a second one", async () => {
    const calls: string[] = []; const posted: any[] = [];
    const win = { url: "https://app.test/inbox", focus: async () => { calls.push("focus"); }, postMessage: (m: any) => posted.push(plain(m)) };
    const sw = boot({ windows: [win] }); await sw.click("", clickData());
    assert.deepEqual(calls, ["focus"]);
    assert.deepEqual(posted, [{ type: "navigate", url: `/errands/${ERRAND}` }]);
    assert.deepEqual(sw.opened, []);
  });

  test("ignores windows from other origins", async () => {
    const sw = boot({ windows: [{ url: "https://other.test/", focus: async () => { throw new Error("no"); }, postMessage() {} }] });
    await sw.click("", clickData());
    assert.equal(sw.opened.length, 1);
  });
});
