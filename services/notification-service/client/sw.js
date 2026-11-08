/* ErrandBoard service worker.
 *
 * Serve from the site ROOT so its scope is "/" (e.g. Vite: put it in /public), and register it as
 *   /sw.js?api=<origin that serves /errands/*>     (omit `api` when the app proxies it same-origin)
 *   /sw.js?notif=<origin that serves /notifications/*>   (same idea; only used to re-subscribe)
 *
 * Responsibilities: show a notification for every push, make its buttons work, focus/open the app
 * on click, and keep the page informed. It never refreshes the session itself (see runAction).
 */
const params = new URL(self.location.href).searchParams;
const API_BASE = params.get("api") || "";
const NOTIF_BASE = params.get("notif") || "";

// The only call the worker may make on its own. The push payload is authenticated by VAPID and
// encrypted end-to-end, but a service worker holding session cookies should still not execute an
// arbitrary request just because a payload says so.
const ALLOWED_ACTION = /^\/errands\/[a-f0-9]{24}\/complete$/;
const ICON = "/icons/icon-192.png";
const BADGE = "/icons/badge-72.png";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// ---------------------------------------------------------------- push
self.addEventListener("push", (event) => event.waitUntil(onPush(event)));

async function onPush(event) {
  let p;
  try { p = event.data ? event.data.json() : null; } catch { p = null; }
  // Browsers (Safari especially) require EVERY push to produce a visible notification or they
  // revoke the subscription, so fall back to something generic rather than showing nothing.
  if (!p || p.v !== 1) p = { v: 1, title: "ErrandBoard", body: "You have a new update", url: "/", actions: [] };

  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const focused = windows.some((w) => w.focused && w.visibilityState === "visible");
  for (const w of windows) w.postMessage({ type: "notification", payload: p }); // lets the open app refresh itself

  // Home-screen / installed apps: show the unread count on the icon where supported.
  try { if (self.navigator && self.navigator.setAppBadge && Number.isFinite(p.unread)) await self.navigator.setAppBadge(p.unread); } catch { /* unsupported */ }

  // Buttons are progressive enhancement. Safari shows none; others cap at 1-3. The server orders
  // actions by usefulness, so keep the first N.
  const max = (self.Notification && self.Notification.maxActions) || 0;
  const buttons = (p.actions || []).slice(0, max).map(({ action, title }) => ({ action, title }));

  await self.registration.showNotification(p.title, {
    body: p.body,
    tag: p.tag,                      // one live notification per errand: newer status replaces older
    renotify: Boolean(p.tag),        // ...but still alert (renotify without a tag throws)
    icon: ICON,
    badge: BADGE,
    timestamp: Date.parse(p.occurredAt) || Date.now(),
    requireInteraction: p.urgency === "high", // desktop: stay until dismissed (ignored on Android/iOS)
    silent: focused,                 // user is looking at the app: show quietly rather than skip (Safari forbids skipping)
    actions: buttons,
    data: { url: p.url || "/", id: p.id, errandId: p.errandId, actions: p.actions || [] },
  });
}

// ---------------------------------------------------------------- click
self.addEventListener("notificationclick", (event) => {
  const { notification } = event;
  const data = notification.data || {};
  notification.close();

  const spec = (data.actions || []).find((a) => a.action === event.action);
  event.waitUntil(spec && spec.request ? runAction(spec, data) : openApp(data.url));
});

async function runAction(spec, data) {
  const { method, path } = spec.request || {};
  if (method !== "POST" || !ALLOWED_ACTION.test(path || "")) return openApp(data.url);

  let res;
  try {
    res = await fetch(API_BASE + path, { method: "POST", credentials: "include" });
  } catch {
    return openApp(data.url); // offline: let the user finish in the app
  }

  if (res.ok) return confirmation(data, "Receipt confirmed", "Thanks! The credits are being released to your courier.");
  // 409: someone/something already moved it on (e.g. auto-completed). Nothing left to do, say so.
  if (res.status === 409) return confirmation(data, "Already updated", "This errand was already completed or changed.");

  // 401/403/5xx. Deliberately NOT refreshing the session here: refresh tokens rotate, so a refresh
  // racing the page's own could invalidate the whole session. The app owns session refresh; open
  // it on the errand so the user can finish there.
  return openApp(data.url);
}

function confirmation(data, title, body) {
  return self.registration.showNotification(title, {
    body, tag: data.errandId ? "errand-" + data.errandId : undefined, icon: ICON, badge: BADGE, data: { url: data.url, actions: [] },
  });
}

async function openApp(path) {
  const target = new URL(path || "/", self.location.origin);
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const w of windows) {
    if (new URL(w.url).origin === target.origin) {
      await w.focus();
      w.postMessage({ type: "navigate", url: target.pathname + target.search + target.hash }); // let the SPA router handle it
      return;
    }
  }
  return self.clients.openWindow(target.href);
}

// ---------------------------------------------------------------- subscription rotation
// Browsers may expire/rotate a subscription. Re-subscribe and tell the server; if the session cookie
// has lapsed this fails quietly and the app re-syncs on its next start (NotificationClient.start()).
self.addEventListener("pushsubscriptionchange", (event) => event.waitUntil(resubscribe()));

async function resubscribe() {
  try {
    const { publicKey } = await (await fetch(NOTIF_BASE + "/notifications/vapid-public-key")).json();
    const sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
    await fetch(NOTIF_BASE + "/notifications/subscriptions", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: sub.toJSON() }),
    });
  } catch { /* the page will re-sync */ }
}
