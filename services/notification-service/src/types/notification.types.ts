export const NOTIFICATION_KINDS = [
  "ERRAND_ACCEPTED",
  "ERRAND_PICKED_UP",
  "ERRAND_DELIVERED",
  "ERRAND_COMPLETED",
  "ERRAND_AUTO_COMPLETED",
  "ERRAND_CANCELLED_BY_COURIER",
  "ERRAND_CANCELLED_TIMEOUT",
  "ERRAND_EXPIRED",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type RecipientRole = "REQUESTER" | "COURIER";
export type Urgency = "normal" | "high";

export interface NotificationAction {
  action: "view" | "confirm";
  title: string;
  request?: { method: "POST"; path: string };
}

// What the API, the SSE stream and the inbox return.
export interface NotificationView {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  url: string;
  errandId: string;
  recipientRole: RecipientRole;
  urgency: Urgency;
  actions: NotificationAction[];
  occurredAt: string;
  readAt: string | null;
}

export interface NewNotification {
  userId: string;
  eventId: string;
  errandId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  url: string;
  recipientRole: RecipientRole;
  urgency: Urgency;
  actions: NotificationAction[];
  occurredAt: Date;
}

export interface StoredNotification extends NotificationView {
  fanoutDone: boolean;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime?: number | null;
}

export interface StoredSubscription extends PushSubscriptionInput {
  userId: string;
  failureCount: number;
}

export interface NotificationStore {
  /** Atomically inserts unless (userId, eventId) exists; returns the stored row either way. */
  insertIfAbsent(n: NewNotification): Promise<StoredNotification>;
  markFanoutDone(id: string): Promise<void>;
  unreadCount(userId: string): Promise<number>;
  list(userId: string, opts: { limit: number; before?: string; unreadOnly?: boolean }): Promise<NotificationView[]>;
  since(userId: string, afterId: string, limit: number): Promise<NotificationView[]>;
  markRead(userId: string, ids: string[]): Promise<number>;
  markAllRead(userId: string): Promise<number>;
}

export interface SubscriptionStore {
  /** Binds the endpoint to this user, moving it if another account used the same browser. */
  upsert(userId: string, sub: PushSubscriptionInput, userAgent?: string): Promise<void>;
  remove(userId: string, endpoint: string): Promise<boolean>;
  listForUser(userId: string): Promise<StoredSubscription[]>;
  removeByEndpoint(endpoint: string): Promise<void>;
  /** Resets or increments the consecutive-failure counter; returns the new value. */
  recordResult(endpoint: string, ok: boolean): Promise<number>;
}
