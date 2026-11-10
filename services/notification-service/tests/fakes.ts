import type { Response } from "express";
import type {
  NewNotification, NotificationStore, NotificationView, PushSubscriptionInput,
  StoredNotification, StoredSubscription, SubscriptionStore,
} from "../src/types/notification.types.js";
import type { PushGateway, PushSendOptions } from "../src/services/push.service.js";
import { PushSendError } from "../src/services/push.service.js";

let counter = 0;
export const nextId = () => (++counter).toString(16).padStart(24, "0");

export class InMemoryNotificationStore implements NotificationStore {
  rows: (StoredNotification & { userId: string; eventId: string })[] = [];
  failNext: Error | null = null;
  inserts = 0;

  private maybeFail() { if (this.failNext) { const e = this.failNext; this.failNext = null; throw e; } }

  async insertIfAbsent(n: NewNotification): Promise<StoredNotification> {
    this.maybeFail();
    const existing = this.rows.find((r) => r.userId === n.userId && r.eventId === n.eventId);
    if (existing) return existing;
    this.inserts++;
    const row = {
      id: nextId(), userId: n.userId, eventId: n.eventId, kind: n.kind, title: n.title, body: n.body, url: n.url,
      errandId: n.errandId, recipientRole: n.recipientRole, urgency: n.urgency, actions: n.actions,
      occurredAt: n.occurredAt.toISOString(), readAt: null, fanoutDone: false,
    };
    this.rows.push(row);
    return row;
  }
  async markFanoutDone(id: string) { const r = this.rows.find((x) => x.id === id); if (r) r.fanoutDone = true; }
  async unreadCount(userId: string) { return this.rows.filter((r) => r.userId === userId && !r.readAt).length; }
  private view(r: (typeof this.rows)[number]): NotificationView { const { userId: _u, eventId: _e, fanoutDone: _f, ...v } = r; return v; }
  async list(userId: string, o: { limit: number; before?: string; unreadOnly?: boolean }) {
    return this.rows.filter((r) => r.userId === userId && (!o.before || r.id < o.before) && (!o.unreadOnly || !r.readAt))
      .sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, o.limit).map((r) => this.view(r));
  }
  async since(userId: string, afterId: string, limit: number) {
    return this.rows.filter((r) => r.userId === userId && r.id > afterId).sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, limit).map((r) => this.view(r));
  }
  async markRead(userId: string, ids: string[]) {
    let n = 0; for (const r of this.rows) if (r.userId === userId && ids.includes(r.id) && !r.readAt) { r.readAt = new Date().toISOString(); n++; } return n;
  }
  async markAllRead(userId: string) {
    let n = 0; for (const r of this.rows) if (r.userId === userId && !r.readAt) { r.readAt = new Date().toISOString(); n++; } return n;
  }
}

export class InMemorySubscriptionStore implements SubscriptionStore {
  subs: StoredSubscription[] = [];
  async upsert(userId: string, sub: PushSubscriptionInput) {
    const i = this.subs.findIndex((s) => s.endpoint === sub.endpoint);
    const row = { userId, endpoint: sub.endpoint, keys: sub.keys, expirationTime: sub.expirationTime ?? null, failureCount: 0 };
    if (i >= 0) this.subs[i] = row; else this.subs.push(row);
  }
  async remove(userId: string, endpoint: string) {
    const before = this.subs.length; this.subs = this.subs.filter((s) => !(s.userId === userId && s.endpoint === endpoint)); return this.subs.length < before;
  }
  async listForUser(userId: string) { return this.subs.filter((s) => s.userId === userId).map((s) => ({ ...s })); }
  async removeByEndpoint(endpoint: string) { this.subs = this.subs.filter((s) => s.endpoint !== endpoint); }
  async recordResult(endpoint: string, ok: boolean) {
    const s = this.subs.find((x) => x.endpoint === endpoint); if (!s) return 0;
    s.failureCount = ok ? 0 : s.failureCount + 1; return s.failureCount;
  }
}

export const sub = (userId: string, host = "fcm.googleapis.com", id = "a"): StoredSubscription => ({
  userId, endpoint: `https://${host}/send/${id}`, keys: { p256dh: "p".repeat(87), auth: "a".repeat(22) }, expirationTime: null, failureCount: 0,
});

export class FakeGateway implements PushGateway {
  sent: { endpoint: string; body: string; opts: PushSendOptions }[] = [];
  /** endpoint -> status code to fail with (undefined = network error) */
  failures = new Map<string, number | undefined>();
  async send(s: StoredSubscription, body: string, opts: PushSendOptions) {
    if (this.failures.has(s.endpoint)) throw new PushSendError("push failed", this.failures.get(s.endpoint));
    this.sent.push({ endpoint: s.endpoint, body, opts });
  }
}

/** Minimal Express Response stand-in for SSE tests. */
export class FakeSse {
  writes: string[] = [];
  headers: Record<string, string> = {};
  statusCode = 0;
  writable = true;
  writableEnded = false;
  private closers: (() => void)[] = [];
  status(code: number) { this.statusCode = code; return this; }
  set(h: Record<string, string>) { Object.assign(this.headers, h); return this; }
  flushHeaders() {}
  write(chunk: string) { this.writes.push(chunk); return true; }
  end() { if (this.writableEnded) return this; this.writableEnded = true; this.writable = false; this.closers.forEach((c) => c()); return this; }
  on(event: string, cb: () => void) { if (event === "close") this.closers.push(cb); return this; }
  get text() { return this.writes.join(""); }
  get res() { return this as unknown as Response; }
}

export function view(over: Partial<NotificationView> = {}): NotificationView {
  return {
    id: nextId(), kind: "ERRAND_ACCEPTED", title: "Errand accepted", body: "A courier accepted your Fine Food errand.",
    url: "/errands/x", errandId: "e".repeat(24), recipientRole: "REQUESTER", urgency: "normal",
    actions: [{ action: "view", title: "View errand" }], occurredAt: new Date().toISOString(), readAt: null, ...over,
  };
}
