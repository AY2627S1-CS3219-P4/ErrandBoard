import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { notificationApiUrl } from "../src/api/client.ts";
import {
  getUnreadCount, listNotifications, markAllNotificationsRead, markNotificationsRead,
} from "../src/notifications/api.ts";
import {
  classifyPush, disablePush, enablePush, releasePushForLogout, sameKey, syncPushSubscription, urlBase64ToUint8Array,
} from "../src/notifications/push.ts";
import { openNotificationStream, STREAM_RECONNECT_DELAY_MS } from "../src/notifications/stream.ts";

// ---------------------------------------------------------------- helpers
function defineGlobal(t, name, value) {
  const had = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  t.after(() => {
    if (had) Object.defineProperty(globalThis, name, had); else delete globalThis[name];
  });
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const flush = () => new Promise((resolve) => setImmediate(resolve));

const KEY_BYTES = [1, 2, 3, 250];
const KEY_B64URL = "AQID-g"; // base64url of KEY_BYTES, unpadded
const API = "/api/notification/notifications";

/** A browser with service workers, push and (optionally) iOS quirks; records everything that happens to it. */
function fakeBrowser(t, opts = {}) {
  const { permission = "granted", requestResult = "granted", ios = false, standalone = false,
    subscription = null, failServerDelete = false, hangServerDelete = false } = opts;
  const log = [];
  const saved = [];
  const store = new Map();

  const pushManager = {
    current: subscription,
    async getSubscription() { return this.current; },
    async subscribe(options) {
      log.push("browser:subscribe");
      pushManager.current = makeSub("https://fcm.googleapis.com/send/new", options.applicationServerKey, options);
      return pushManager.current;
    },
  };
  function makeSub(endpoint, key, options = {}) {
    return {
      endpoint, options: { applicationServerKey: key }, subscribeOptions: options,
      toJSON: () => ({ endpoint, keys: { p256dh: "pk", auth: "ak" } }),
      async unsubscribe() { log.push("browser:unsubscribe"); pushManager.current = null; return true; },
    };
  }
  const registration = { pushManager };
  const nav = {
    userAgent: ios ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" : "Mozilla/5.0 Chrome/130",
    platform: ios ? "iPhone" : "Linux", maxTouchPoints: ios ? 5 : 0, standalone,
    serviceWorker: {
      register: async (url) => { log.push(`register:${url}`); return registration; },
      ready: Promise.resolve(registration),
      getRegistration: async () => registration,
    },
  };
  const Notif = { permission, requestPermission: async () => { log.push("permission:request"); Notif.permission = requestResult; return requestResult; } };
  defineGlobal(t, "navigator", nav);
  defineGlobal(t, "window", { PushManager: function PushManager() {}, Notification: Notif, matchMedia: () => ({ matches: standalone }) });
  defineGlobal(t, "Notification", Notif);
  defineGlobal(t, "localStorage", {
    getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k),
  });
  defineGlobal(t, "fetch", async (url, init = {}) => {
    const path = String(url);
    log.push(`fetch:${init.method ?? "GET"} ${path}`);
    if (path === `${API}/vapid-public-key`) return json({ publicKey: KEY_B64URL });
    if (path === `${API}/subscriptions`) { saved.push(JSON.parse(init.body)); return json({ ok: true }, 201); }
    if (path === `${API}/subscriptions/unsubscribe`) {
      if (hangServerDelete) return new Promise(() => {});
      return failServerDelete ? json({ error: "x" }, 500) : json({ removed: true });
    }
    return json({}, 404);
  });
  return { log, saved, store, pushManager, Notif, makeSub, registration };
}
const keyBuf = () => new Uint8Array(KEY_BYTES).buffer;

// ---------------------------------------------------------------- pure logic
describe("classifyPush", () => {
  const base = { userAgent: "Chrome", platform: "Linux", maxTouchPoints: 0, standalone: false, serviceWorker: true, pushManager: true, permission: "default" };
  const state = (over) => classifyPush({ ...base, ...over });

  test("maps the three Notification permissions", () => {
    assert.equal(state({ permission: "default" }), "default");
    assert.equal(state({ permission: "granted" }), "granted");
    assert.equal(state({ permission: "denied" }), "denied");
  });
  test("unsupported without service workers (e.g. plain http), push, or the Notification API", () => {
    assert.equal(state({ serviceWorker: false }), "unsupported");
    assert.equal(state({ pushManager: false }), "unsupported");
    assert.equal(state({ permission: null }), "unsupported");
  });
  test("iPhone in a browser tab must be installed to the Home Screen first", () => {
    const iphone = { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", platform: "iPhone", maxTouchPoints: 5 };
    assert.equal(state({ ...iphone, standalone: false }), "needs-install");
    assert.equal(state({ ...iphone, standalone: true }), "default");
    assert.equal(state({ ...iphone, standalone: true, permission: "granted" }), "granted");
  });
  test("iPadOS pretends to be a Mac; touch support gives it away, a real Mac is unaffected", () => {
    assert.equal(state({ platform: "MacIntel", maxTouchPoints: 5, standalone: false }), "needs-install");
    assert.equal(state({ platform: "MacIntel", maxTouchPoints: 0, standalone: false }), "default");
  });
  test("an old iOS that has no PushManager is unsupported even when installed", () => {
    assert.equal(state({ platform: "iPhone", userAgent: "iPhone", maxTouchPoints: 5, standalone: true, pushManager: false }), "unsupported");
  });
});

describe("key helpers", () => {
  test("decodes unpadded base64url", () => assert.deepEqual([...urlBase64ToUint8Array(KEY_B64URL)], KEY_BYTES));
  test("sameKey compares bytes, not identity, and tolerates a missing key", () => {
    const key = urlBase64ToUint8Array(KEY_B64URL);
    assert.equal(sameKey(keyBuf(), key), true);
    assert.equal(sameKey(new Uint8Array([9, 9, 9, 9]).buffer, key), false);
    assert.equal(sameKey(new Uint8Array([1, 2, 3]).buffer, key), false);
    assert.equal(sameKey(null, key), false);
  });
  test("api url helper follows the other services' pattern", () => {
    assert.equal(notificationApiUrl("/notifications/stream"), "/api/notification/notifications/stream");
    assert.equal(notificationApiUrl("notifications"), "/api/notification/notifications");
  });
});

// ---------------------------------------------------------------- REST API
describe("notification api", () => {
  test("markNotificationsRead posts the ids with credentials and returns the server's unread count", async (t) => {
    const calls = [];
    defineGlobal(t, "fetch", async (url, init) => { calls.push({ url, init }); return json({ updated: 2, unread: 5 }); });
    assert.equal(await markNotificationsRead(["a", "b"]), 5);
    assert.equal(calls[0].url, `${API}/read`);
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.credentials, "include");
    assert.deepEqual(JSON.parse(calls[0].init.body), { ids: ["a", "b"] });
  });

  test("markAll posts { all: true }", async (t) => {
    let body;
    defineGlobal(t, "fetch", async (_url, init) => { body = JSON.parse(init.body); return json({ updated: 3, unread: 0 }); });
    assert.equal(await markAllNotificationsRead(), 0);
    assert.deepEqual(body, { all: true });
  });

  test("a failed request rejects instead of pretending it worked", async (t) => {
    defineGlobal(t, "fetch", async () => json({ error: "nope" }, 500));
    await assert.rejects(markNotificationsRead(["a"]), /HTTP 500/);
    await assert.rejects(getUnreadCount(), /HTTP 500/);
    await assert.rejects(listNotifications(), /HTTP 500/);
  });

  test("listNotifications builds its query and returns the cursor", async (t) => {
    let url;
    defineGlobal(t, "fetch", async (u) => { url = u; return json({ items: [{ id: "1" }], nextCursor: "1" }); });
    const page = await listNotifications({ limit: 30, before: "abc" });
    assert.equal(url, `${API}?limit=30&before=abc`);
    assert.deepEqual(page, { items: [{ id: "1" }], nextCursor: "1" });
  });

  test("malformed responses are rejected", async (t) => {
    defineGlobal(t, "fetch", async () => json({ items: "nope" }));
    await assert.rejects(listNotifications(), /invalid shape/);
    defineGlobal(t, "fetch", async () => json({ unread: -1 }));
    await assert.rejects(getUnreadCount(), /invalid shape/);
  });
});

// ---------------------------------------------------------------- push lifecycle
describe("enablePush", () => {
  test("asks permission, subscribes with the server's key, and binds the subscription to the user", async (t) => {
    const b = fakeBrowser(t, { permission: "default", requestResult: "granted" });
    assert.equal(await enablePush(), "granted");
    assert.deepEqual(b.log.filter((l) => !l.startsWith("fetch:GET")), [
      "permission:request",
      "register:/sw.js?api=%2Fapi%2Forder&notif=%2Fapi%2Fnotification",
      "browser:subscribe",
      `fetch:POST ${API}/subscriptions`,
    ]);
    assert.deepEqual([...b.pushManager.current.subscribeOptions.applicationServerKey], KEY_BYTES);
    assert.equal(b.pushManager.current.subscribeOptions.userVisibleOnly, true);
    assert.deepEqual(b.saved, [{ subscription: { endpoint: "https://fcm.googleapis.com/send/new", keys: { p256dh: "pk", auth: "ak" } } }]);
  });

  test("a user who dismisses the permission prompt is not subscribed", async (t) => {
    const b = fakeBrowser(t, { permission: "default", requestResult: "default" });
    assert.equal(await enablePush(), "default");
    assert.deepEqual(b.log, ["permission:request"]);
  });

  test("does nothing when permission is blocked or iOS needs installing", async (t) => {
    const denied = fakeBrowser(t, { permission: "denied" });
    assert.equal(await enablePush(), "denied");
    assert.deepEqual(denied.log, []);
    const ios = fakeBrowser(t, { permission: "default", ios: true, standalone: false });
    assert.equal(await enablePush(), "needs-install");
    assert.deepEqual(ios.log, []);
  });

  test("an existing subscription with the same key is reused, but still re-saved (re-binds a shared browser)", async (t) => {
    const b = fakeBrowser(t);
    b.pushManager.current = b.makeSub("https://fcm.googleapis.com/send/old", keyBuf());
    await enablePush();
    assert.equal(b.log.includes("browser:subscribe"), false);
    assert.equal(b.log.includes("browser:unsubscribe"), false);
    assert.equal(b.saved[0].subscription.endpoint, "https://fcm.googleapis.com/send/old");
  });

  test("a subscription made with an old VAPID key is replaced", async (t) => {
    const b = fakeBrowser(t);
    b.pushManager.current = b.makeSub("https://fcm.googleapis.com/send/stale", new Uint8Array([9, 9, 9, 9]).buffer);
    await enablePush();
    assert.deepEqual(b.log.filter((l) => l.startsWith("browser:")), ["browser:unsubscribe", "browser:subscribe"]);
    assert.equal(b.saved[0].subscription.endpoint, "https://fcm.googleapis.com/send/new");
  });
});

describe("syncPushSubscription (runs on app start)", () => {
  test("re-binds an existing grant to whoever is signed in", async (t) => {
    const b = fakeBrowser(t, { permission: "granted" });
    await syncPushSubscription();
    assert.equal(b.saved.length, 1);
  });
  test("does nothing without a grant", async (t) => {
    const b = fakeBrowser(t, { permission: "default" });
    await syncPushSubscription();
    assert.deepEqual(b.log, []);
  });
});

describe("disablePush", () => {
  test("removes it on the server FIRST (it needs the session), then in the browser", async (t) => {
    const b = fakeBrowser(t);
    b.pushManager.current = b.makeSub("https://fcm.googleapis.com/send/x", keyBuf());
    await disablePush();
    assert.deepEqual(b.log, [`fetch:POST ${API}/subscriptions/unsubscribe`, "browser:unsubscribe"]);
  });

  test("the choice survives a reload: later syncs do not quietly turn it back on", async (t) => {
    const b = fakeBrowser(t);
    b.pushManager.current = b.makeSub("https://fcm.googleapis.com/send/x", keyBuf());
    await disablePush();
    b.log.length = 0;
    await syncPushSubscription();
    assert.deepEqual(b.log, []);
    await enablePush();
    assert.equal(b.saved.length, 1);
    b.saved.length = 0;
    await syncPushSubscription();
    assert.equal(b.saved.length, 1);
  });

  test("if the server call fails it rejects, leaves the subscription alone and does NOT record an opt-out", async (t) => {
    const b = fakeBrowser(t, { failServerDelete: true });
    b.pushManager.current = b.makeSub("https://fcm.googleapis.com/send/x", keyBuf());
    await assert.rejects(disablePush(), /HTTP 500/);
    assert.equal(b.log.includes("browser:unsubscribe"), false);
    assert.notEqual(b.pushManager.current, null);
    await syncPushSubscription();
    assert.equal(b.saved.length, 1, "still opted in");
  });
});

describe("releasePushForLogout", () => {
  test("detaches this device while the session still works, server first", async (t) => {
    const b = fakeBrowser(t);
    b.pushManager.current = b.makeSub("https://fcm.googleapis.com/send/x", keyBuf());
    await releasePushForLogout();
    assert.deepEqual(b.log, [`fetch:POST ${API}/subscriptions/unsubscribe`, "browser:unsubscribe"]);
  });

  test("never blocks or fails a logout, even if the server call fails (the browser side is still removed)", async (t) => {
    const b = fakeBrowser(t, { failServerDelete: true });
    b.pushManager.current = b.makeSub("https://fcm.googleapis.com/send/x", keyBuf());
    await releasePushForLogout();
    assert.equal(b.log.includes("browser:unsubscribe"), true);
  });

  test("gives up after the timeout when the network hangs", async (t) => {
    const b = fakeBrowser(t, { hangServerDelete: true });
    b.pushManager.current = b.makeSub("https://fcm.googleapis.com/send/x", keyBuf());
    const started = Date.now();
    await releasePushForLogout(30);
    assert.ok(Date.now() - started < 1000);
  });

  test("a device with no subscription makes no requests", async (t) => {
    const b = fakeBrowser(t);
    await releasePushForLogout();
    assert.deepEqual(b.log, []);
  });

  test("it is not an opt-out: the next sign-in on this browser re-subscribes by itself", async (t) => {
    const b = fakeBrowser(t);
    b.pushManager.current = b.makeSub("https://fcm.googleapis.com/send/x", keyBuf());
    await releasePushForLogout();
    await syncPushSubscription();
    assert.equal(b.saved.length, 1);
  });
});

// ---------------------------------------------------------------- live stream
class FakeEventSource {
  static CONNECTING = 0; static OPEN = 1; static CLOSED = 2; static instances = [];
  constructor(url, init) {
    this.url = url; this.init = init; this.readyState = 0; this.closed = false; this.onerror = null; this.listeners = {};
    FakeEventSource.instances.push(this);
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  close() { this.closed = true; this.readyState = 2; }
  emit(type, data) { for (const fn of this.listeners[type] ?? []) fn({ data }); }
  fail(readyState) { this.readyState = readyState; this.onerror?.({}); }
}
function streamEnv(t, fetchImpl) {
  FakeEventSource.instances = [];
  defineGlobal(t, "EventSource", FakeEventSource);
  const fetched = [];
  defineGlobal(t, "fetch", fetchImpl ?? (async (url) => { fetched.push(String(url)); return json({ unread: 0 }); }));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  return { fetched, sources: FakeEventSource.instances };
}
const NOTE = { id: "n1", title: "Errand accepted", body: "b", url: "/errands/active", urgency: "normal", actions: [], occurredAt: "2026-11-03T08:00:00.000Z", readAt: null };

describe("openNotificationStream", () => {
  test("connects to the stream endpoint with credentials", (t) => {
    const { sources } = streamEnv(t);
    const close = openNotificationStream({ onNotification() {} });
    assert.equal(sources[0].url, "/api/notification/notifications/stream");
    assert.deepEqual(sources[0].init, { withCredentials: true });
    close();
  });

  test("delivers valid notifications and ignores malformed ones", (t) => {
    const { sources } = streamEnv(t);
    const got = [];
    const close = openNotificationStream({ onNotification: (n) => got.push(n.id) });
    sources[0].emit("notification", JSON.stringify(NOTE));
    sources[0].emit("notification", "{not json");
    sources[0].emit("notification", JSON.stringify({ title: "no id" }));
    sources[0].emit("notification", "null");
    assert.deepEqual(got, ["n1"]);
    close();
  });

  test("onReady reports whether this is a reconnect, so the caller can re-sync what it missed", async (t) => {
    const { sources } = streamEnv(t);
    const seen = [];
    const close = openNotificationStream({ onNotification() {}, onReady: (r) => seen.push(r) });
    sources[0].emit("ready", "{}");
    sources[0].fail(2); await flush(); t.mock.timers.tick(STREAM_RECONNECT_DELAY_MS);
    sources[1].emit("ready", "{}");
    assert.deepEqual(seen, [false, true]);
    close();
  });

  test("while the browser is retrying by itself (CONNECTING) we do not interfere, so Last-Event-ID resume still works", async (t) => {
    const { sources, fetched } = streamEnv(t);
    const close = openNotificationStream({ onNotification() {} });
    sources[0].fail(0);
    await flush(); t.mock.timers.tick(STREAM_RECONNECT_DELAY_MS * 2);
    assert.equal(sources[0].closed, false);
    assert.equal(sources.length, 1);
    assert.deepEqual(fetched, []);
    close();
  });

  test("once the browser gives up (CLOSED, e.g. 401), refresh the session via an API call, then reconnect after a delay", async (t) => {
    const { sources, fetched } = streamEnv(t);
    const close = openNotificationStream({ onNotification() {} });
    sources[0].fail(2);
    assert.equal(sources[0].closed, true);
    await flush();
    assert.deepEqual(fetched, ["/api/notification/notifications/unread-count"]);
    assert.equal(sources.length, 1, "not before the delay");
    t.mock.timers.tick(STREAM_RECONNECT_DELAY_MS - 1);
    assert.equal(sources.length, 1);
    t.mock.timers.tick(1);
    assert.equal(sources.length, 2);
    close();
  });

  test("reconnects even if the session probe fails", async (t) => {
    const { sources } = streamEnv(t, async () => { throw new Error("offline"); });
    const close = openNotificationStream({ onNotification() {} });
    sources[0].fail(2); await flush();
    t.mock.timers.tick(STREAM_RECONNECT_DELAY_MS);
    assert.equal(sources.length, 2);
    close();
  });

  test("repeated error events do not start parallel recoveries", async (t) => {
    const { sources, fetched } = streamEnv(t);
    const close = openNotificationStream({ onNotification() {} });
    sources[0].fail(2); sources[0].fail(2); sources[0].fail(2);
    await flush(); t.mock.timers.tick(STREAM_RECONNECT_DELAY_MS);
    assert.equal(fetched.length, 1);
    assert.equal(sources.length, 2);
    close();
  });

  test("closing stops everything, including a reconnect that is already scheduled", async (t) => {
    const { sources } = streamEnv(t);
    const close = openNotificationStream({ onNotification() {} });
    sources[0].fail(2); await flush();
    close();
    t.mock.timers.tick(STREAM_RECONNECT_DELAY_MS * 3);
    assert.equal(sources.length, 1);
  });
});
