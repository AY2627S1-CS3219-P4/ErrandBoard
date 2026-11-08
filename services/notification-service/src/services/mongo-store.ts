import { Notification } from "../models/Notification.js";
import { PushSubscriptionModel } from "../models/PushSubscription.js";
import type {
  NewNotification, NotificationStore, NotificationView, PushSubscriptionInput,
  StoredNotification, StoredSubscription, SubscriptionStore,
} from "../types/notification.types.js";

export const MAX_SUBSCRIPTIONS_PER_USER = 10;

interface Row {
  _id: { toString(): string };
  kind: NotificationView["kind"]; title: string; body: string; url: string; errandId: string;
  recipientRole: NotificationView["recipientRole"]; urgency: NotificationView["urgency"];
  actions?: NotificationView["actions"]; occurredAt: Date; readAt?: Date | null; fanoutAt?: Date | null;
}

function toView(row: Row): NotificationView {
  return {
    id: row._id.toString(),
    kind: row.kind,
    title: row.title,
    body: row.body,
    url: row.url,
    errandId: row.errandId,
    recipientRole: row.recipientRole,
    urgency: row.urgency,
    actions: (row.actions ?? []).map((a) => ({ action: a.action, title: a.title, ...(a.request ? { request: a.request } : {}) })),
    occurredAt: row.occurredAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
  };
}

const isDuplicateKey = (e: unknown) => (e as { code?: number })?.code === 11000;

export class MongoNotificationStore implements NotificationStore {
  async insertIfAbsent(n: NewNotification): Promise<StoredNotification> {
    const { userId, eventId, ...rest } = n;
    const run = () => Notification.findOneAndUpdate(
      { userId, eventId },
      { $setOnInsert: { ...rest, readAt: null, fanoutAt: null } },
      { upsert: true, returnDocument: "after" },
    ).lean<Row>();

    let row: Row | null;
    try {
      row = await run();
    } catch (error) {
      // two consumers raced to insert the same (userId, eventId): the loser just reads the winner
      if (!isDuplicateKey(error)) throw error;
      row = await run();
    }
    if (!row) throw new Error("notification upsert returned no document");
    return { ...toView(row), fanoutDone: row.fanoutAt != null };
  }

  async markFanoutDone(id: string): Promise<void> {
    await Notification.updateOne({ _id: id }, { $set: { fanoutAt: new Date() } }, { timestamps: false });
  }

  unreadCount(userId: string): Promise<number> {
    return Notification.countDocuments({ userId, readAt: null });
  }

  async list(userId: string, opts: { limit: number; before?: string; unreadOnly?: boolean }): Promise<NotificationView[]> {
    const q: Record<string, unknown> = { userId };
    if (opts.before) q._id = { $lt: opts.before };
    if (opts.unreadOnly) q.readAt = null;
    const rows = await Notification.find(q).sort({ _id: -1 }).limit(opts.limit).lean<Row[]>();
    return rows.map(toView);
  }

  async since(userId: string, afterId: string, limit: number): Promise<NotificationView[]> {
    const rows = await Notification.find({ userId, _id: { $gt: afterId } }).sort({ _id: 1 }).limit(limit).lean<Row[]>();
    return rows.map(toView);
  }

  async markRead(userId: string, ids: string[]): Promise<number> {
    const res = await Notification.updateMany(
      { userId, _id: { $in: ids }, readAt: null }, // userId in the filter: nobody can mark someone else's rows
      { $set: { readAt: new Date() } },
      { timestamps: false },
    );
    return res.modifiedCount;
  }

  async markAllRead(userId: string): Promise<number> {
    const res = await Notification.updateMany({ userId, readAt: null }, { $set: { readAt: new Date() } }, { timestamps: false });
    return res.modifiedCount;
  }
}

export class MongoSubscriptionStore implements SubscriptionStore {
  async upsert(userId: string, sub: PushSubscriptionInput, userAgent?: string): Promise<void> {
    // Keyed by endpoint, NOT by (user, endpoint): if a different account signs in on the same
    // browser the subscription moves to them, so the previous user stops receiving pushes on a
    // device they no longer use.
    await PushSubscriptionModel.updateOne(
      { endpoint: sub.endpoint },
      { $set: { userId, keys: sub.keys, expirationTime: sub.expirationTime ?? null, userAgent: userAgent?.slice(0, 300), failureCount: 0 } },
      { upsert: true },
    );
    // Bound the fan-out per notification: keep the newest N devices.
    const stale = await PushSubscriptionModel.find({ userId }).sort({ updatedAt: -1 }).skip(MAX_SUBSCRIPTIONS_PER_USER).select("_id").lean();
    if (stale.length) await PushSubscriptionModel.deleteMany({ _id: { $in: stale.map((s) => s._id) } });
  }

  async remove(userId: string, endpoint: string): Promise<boolean> {
    const res = await PushSubscriptionModel.deleteOne({ userId, endpoint }); // userId: only the owner can remove
    return res.deletedCount > 0;
  }

  async listForUser(userId: string): Promise<StoredSubscription[]> {
    const rows = await PushSubscriptionModel.find({ userId }).lean();
    return rows.map((r) => ({
      userId: r.userId,
      endpoint: r.endpoint,
      keys: { p256dh: r.keys.p256dh, auth: r.keys.auth },
      expirationTime: r.expirationTime ?? null,
      failureCount: r.failureCount ?? 0,
    }));
  }

  async removeByEndpoint(endpoint: string): Promise<void> {
    await PushSubscriptionModel.deleteOne({ endpoint });
  }

  async recordResult(endpoint: string, ok: boolean): Promise<number> {
    if (ok) {
      await PushSubscriptionModel.updateOne({ endpoint, failureCount: { $gt: 0 } }, { $set: { failureCount: 0 } }, { timestamps: false });
      return 0;
    }
    const row = await PushSubscriptionModel.findOneAndUpdate(
      { endpoint }, { $inc: { failureCount: 1 } }, { returnDocument: "after", timestamps: false },
    ).lean();
    return row?.failureCount ?? 0;
  }
}
