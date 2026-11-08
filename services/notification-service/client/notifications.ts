/**
 * Framework-agnostic browser client for the Notification Service. Works with React/Vue/vanilla:
 * create one instance after login, call start(), and call stop() on logout.
 *
 *   const nc = new NotificationClient({
 *     notificationsBase: "",                 // "" = same origin via your dev/prod proxy
 *     apiBase: "",                           // where /errands/* lives (the service worker calls it)
 *     refreshSession: () => fetch("/auth/refresh", { method: "POST", credentials: "include" }).then(r => r.ok),
 *     onNotification: (n) => { toast(n); refreshBadge(); },
 *     onNavigate: (url) => router.push(url),
 *   });
 *   await nc.start();
 *   button.onclick = () => nc.enablePush();   // MUST be a user gesture
 *   logoutButton.onclick = async () => { await nc.stop({ unsubscribe: true }); await logout(); };
 */
export interface NotificationView {
  id: string; kind: string; title: string; body: string; url: string; errandId: string;
  recipientRole: "REQUESTER" | "COURIER"; urgency: "normal" | "high";
  actions: { action: string; title: string }[]; occurredAt: string; readAt: string | null;
}

export interface ClientOptions {
  notificationsBase?: string;
  apiBase?: string;
  swUrl?: string;
  /** Called for each live notification (SSE or forwarded from a push). Deduped by id. */
  onNotification?: (n: NotificationView | Record<string, unknown>) => void;
  /** Called when a notification click should route the SPA (otherwise a full page load). */
  onNavigate?: (url: string) => void;
  /** Refresh the session cookie; used when the stream drops (EventSource cannot see a 401). */
  refreshSession?: () => Promise<boolean>;
}

export type PushState = "unsupported" | "needs-install" | "denied" | "default" | "granted";

const urlBase64ToUint8Array = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export class NotificationClient {
  private es?: EventSource;
  private backoff = 1000;
  private stopped = true;
  private seen = new Set<string>();
  private reg?: ServiceWorkerRegistration;
  private readonly nb: string;

  constructor(private readonly o: ClientOptions = {}) { this.nb = o.notificationsBase ?? ""; }

  /** What this browser can do, so the UI can show the right prompt. */
  pushState(): PushState {
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone = (navigator as any).standalone === true || matchMedia("(display-mode: standalone)").matches;
    // iOS/iPadOS only exposes the Push API to a web app that was added to the Home Screen.
    if (isIos && !standalone) return "needs-install";
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
    return Notification.permission as PushState;
  }

  /** Number of buttons this browser can show on a notification (0 on Safari/iOS). */
  maxActions(): number { return (window.Notification as any)?.maxActions ?? 0; }

  async start(): Promise<void> {
    this.stopped = false;
    if ("serviceWorker" in navigator) {
      const q = new URLSearchParams();
      if (this.o.apiBase) q.set("api", this.o.apiBase);
      if (this.nb) q.set("notif", this.nb);
      this.reg = await navigator.serviceWorker.register(`${this.o.swUrl ?? "/sw.js"}${q.size ? `?${q}` : ""}`);
      navigator.serviceWorker.addEventListener("message", (e) => this.onWorkerMessage(e.data));
      // Re-sync on every start: covers rotated/expired subscriptions that the worker could not repair.
      if (Notification.permission === "granted") await this.subscribe().catch(() => {});
    }
    this.connect();
  }

  /** Ask for permission and register this browser. Call from a click handler. */
  async enablePush(): Promise<PushState> {
    const state = this.pushState();
    if (state === "unsupported" || state === "needs-install" || state === "denied") return state;
    if ((await Notification.requestPermission()) !== "granted") return Notification.permission as PushState;
    await this.subscribe();
    return "granted";
  }

  async stop(opts: { unsubscribe?: boolean } = {}): Promise<void> {
    this.stopped = true;
    this.es?.close();
    if (opts.unsubscribe) {
      // Without this the next person to log in on a shared browser would be addressed as you
      // (the server also re-binds on their next subscribe, but only if they enable push).
      const sub = await (this.reg ?? (await navigator.serviceWorker?.ready))?.pushManager.getSubscription();
      if (sub) {
        await this.api("/notifications/subscriptions/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
      (navigator as any).clearAppBadge?.();
    }
  }

  // ---- inbox ----
  async list(opts: { before?: string; limit?: number; unread?: boolean } = {}) {
    const q = new URLSearchParams();
    if (opts.before) q.set("before", opts.before);
    if (opts.limit) q.set("limit", String(opts.limit));
    if (opts.unread) q.set("unread", "true");
    return (await this.api(`/notifications?${q}`)).json() as Promise<{ items: NotificationView[]; nextCursor: string | null }>;
  }
  async unreadCount(): Promise<number> { return (await (await this.api("/notifications/unread-count")).json()).unread; }
  async markRead(ids: string[]) { return (await this.api("/notifications/read", { method: "POST", body: JSON.stringify({ ids }) })).json(); }
  async markAllRead() { return (await this.api("/notifications/read", { method: "POST", body: JSON.stringify({ all: true }) })).json(); }

  // ---- internals ----
  private async subscribe() {
    const reg = this.reg ?? (await navigator.serviceWorker.ready);
    const { publicKey } = await (await fetch(`${this.nb}/notifications/vapid-public-key`)).json();
    const sub = (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
    await this.api("/notifications/subscriptions", { method: "POST", body: JSON.stringify({ subscription: sub.toJSON() }) });
  }

  private api(path: string, init: RequestInit = {}) {
    return fetch(`${this.nb}${path}`, { credentials: "include", headers: { "Content-Type": "application/json" }, ...init })
      .then((r) => { if (!r.ok) throw new Error(`${path} -> ${r.status}`); return r; });
  }

  private emit(n: any) {
    if (n?.id) { if (this.seen.has(n.id)) return; this.seen.add(n.id); if (this.seen.size > 200) this.seen.delete(this.seen.values().next().value!); }
    this.o.onNotification?.(n);
  }

  private onWorkerMessage(m: any) {
    if (m?.type === "notification") this.emit(m.payload);
    if (m?.type === "navigate") (this.o.onNavigate ?? ((u: string) => location.assign(u)))(m.url);
  }

  private connect() {
    if (this.stopped) return;
    // The browser re-sends Last-Event-ID on its own reconnects, so nothing is missed.
    this.es = new EventSource(`${this.nb}/notifications/stream`, { withCredentials: true });
    this.es.addEventListener("ready", () => { this.backoff = 1000; });
    this.es.addEventListener("notification", (e) => this.emit(JSON.parse((e as MessageEvent).data)));
    this.es.onerror = async () => {
      // The server ends streams periodically (to re-authenticate) and the browser reconnects by
      // itself. But if the connection FAILED (e.g. 401 after the 15-min access token expired) the
      // browser gives up for good, so rebuild it ourselves after refreshing the session.
      if (this.es?.readyState === EventSource.CONNECTING) return;
      this.es?.close();
      await this.o.refreshSession?.().catch(() => false);
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30_000);
    };
  }
}
