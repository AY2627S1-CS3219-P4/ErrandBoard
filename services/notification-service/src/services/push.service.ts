import webpush from "web-push";
import { settings } from "../config/settings.js";
import type { NotificationView, StoredSubscription, SubscriptionStore, Urgency } from "../types/notification.types.js";

// Everything the service worker needs to render and act on a notification. Kept small: push
// services cap payloads (~4 KB) and the body is shown on lock screens.
export interface PushPayload {
  v: 1;
  id: string;
  tag: string;
  title: string;
  body: string;
  url: string;
  kind: string;
  errandId: string;
  urgency: Urgency;
  actions: NotificationView["actions"];
  occurredAt: string;
  unread: number;
}

export function buildPushPayload(n: NotificationView, unread: number): PushPayload {
  return {
    v: 1,
    id: n.id,
    // one live notification per errand: a newer status replaces the older one instead of stacking
    tag: `errand-${n.errandId}`,
    title: n.title,
    body: n.body,
    url: n.url,
    kind: n.kind,
    errandId: n.errandId,
    urgency: n.urgency,
    actions: n.actions,
    occurredAt: n.occurredAt,
    unread,
  };
}

export interface PushSendOptions {
  ttlSeconds: number;
  urgency: "normal" | "high";
  /** Collapses queued messages for an offline device: only the latest per topic is delivered. */
  topic: string;
}

export class PushSendError extends Error {
  constructor(message: string, readonly statusCode: number | undefined) { super(message); }
}

export interface PushGateway {
  send(sub: StoredSubscription, body: string, opts: PushSendOptions): Promise<void>;
}

export class WebPushGateway implements PushGateway {
  constructor(publicKey: string, privateKey: string, subject: string) {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  }

  async send(sub: StoredSubscription, body: string, opts: PushSendOptions): Promise<void> {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        body,
        { TTL: opts.ttlSeconds, urgency: opts.urgency, topic: opts.topic, timeout: 10_000 },
      );
    } catch (error) {
      const statusCode = (error as { statusCode?: number }).statusCode;
      throw new PushSendError((error as Error).message, statusCode);
    }
  }
}

/** Build the gateway from env, or null when Web Push is intentionally off. */
export function createPushGateway(): PushGateway | null {
  if (settings.pushDisabled) return null;
  const { vapidPublicKey: pub, vapidPrivateKey: priv, vapidSubject: subject } = settings;
  if (!pub || !priv || !subject) {
    throw new Error("VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are required (or set PUSH_DISABLED=true). Generate keys with `npm run vapid:generate`.");
  }
  return new WebPushGateway(pub, priv, subject);
}

export const MAX_CONSECUTIVE_FAILURES = 8;
export interface PushOutcome { sent: number; removed: number; failed: number }

export class PushDispatcher {
  constructor(
    private readonly subscriptions: SubscriptionStore,
    private readonly gateway: PushGateway | null,
  ) {}

  get enabled(): boolean { return this.gateway !== null; }

  /** Delivers to every browser the user registered. Per-device failures never throw. */
  async sendToUser(userId: string, payload: PushPayload): Promise<PushOutcome> {
    const outcome: PushOutcome = { sent: 0, removed: 0, failed: 0 };
    if (!this.gateway) return outcome;

    const gateway = this.gateway;
    const body = JSON.stringify(payload);
    const subs = await this.subscriptions.listForUser(userId);
    const options: PushSendOptions = {
      ttlSeconds: 24 * 60 * 60, // a status update older than a day is noise
      urgency: payload.urgency,
      topic: payload.errandId,
    };

    await Promise.all(subs.map(async (sub) => {
      try {
        await gateway.send(sub, body, options);
        outcome.sent++;
        await this.subscriptions.recordResult(sub.endpoint, true);
      } catch (error) {
        const status = error instanceof PushSendError ? error.statusCode : undefined;
        if (status === 404 || status === 410) {
          // The browser unsubscribed or the subscription expired: it will never work again.
          await this.subscriptions.removeByEndpoint(sub.endpoint);
          outcome.removed++;
          return;
        }
        outcome.failed++;
        if (status === 401 || status === 403) {
          console.error("Push service rejected our VAPID credentials; check VAPID_* configuration");
        } else {
          console.warn(`Push to ${new URL(sub.endpoint).host} failed (${status ?? "network"}):`, (error as Error).message);
        }
        const failures = await this.subscriptions.recordResult(sub.endpoint, false);
        if (failures >= MAX_CONSECUTIVE_FAILURES && status !== 401 && status !== 403) {
          await this.subscriptions.removeByEndpoint(sub.endpoint);
          outcome.removed++;
        }
      }
    }));
    return outcome;
  }
}
