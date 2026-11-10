import { planNotifications, type RuleOptions } from "../domain/notification-rules.js";
import type { StatusChangeEvent } from "../event/errand-status-event.js";
import type { NotificationStore, StoredNotification, NotificationView } from "../types/notification.types.js";
import type { LiveHub } from "./live-hub.js";
import { buildPushPayload, type PushDispatcher } from "./push.service.js";

export interface ProcessorDeps {
  notifications: NotificationStore;
  hub: LiveHub;
  push: PushDispatcher;
  rules: RuleOptions;
  /** Frontend path for an errand, e.g. `/errands/<id>` */
  errandPath: (errandId: string) => string;
}

export interface ProcessResult { planned: number; delivered: number }

function toView(n: StoredNotification): NotificationView {
  const { fanoutDone: _fanoutDone, ...view } = n;
  return view;
}

/**
 * Turns one status event into inbox rows + live/push delivery.
 *
 * Idempotent under RabbitMQ's at-least-once delivery: the inbox row is the idempotency record
 * (unique on userId + eventId) and carries a `fanoutDone` marker. A redelivery after a crash
 * between "row inserted" and "delivered" finishes the delivery; a redelivery after success is a no-op.
 * The marker is written last, so the failure mode is a possible duplicate push, never a lost one;
 * the shared notification `tag` makes a duplicate replace the first instead of stacking.
 *
 * Only DB errors propagate (and cause a retry). Push/SSE problems are handled per device.
 */
export async function processStatusEvent(ev: StatusChangeEvent, deps: ProcessorDeps): Promise<ProcessResult> {
  const planned = planNotifications(ev.value, deps.rules);
  let delivered = 0;

  for (const p of planned) {
    const stored = await deps.notifications.insertIfAbsent({
      userId: p.recipientId,
      eventId: ev.value.eventId,
      errandId: ev.value.errandId,
      kind: p.kind,
      title: p.title,
      body: p.body,
      url: deps.errandPath(ev.value.errandId),
      recipientRole: p.recipientRole,
      urgency: p.urgency,
      actions: p.actions,
      occurredAt: new Date(ev.value.occurredAt),
    });
    if (stored.fanoutDone) continue;

    const view = toView(stored);
    deps.hub.publish(p.recipientId, view);
    const unread = await deps.notifications.unreadCount(p.recipientId);
    await deps.push.sendToUser(p.recipientId, buildPushPayload(view, unread));
    await deps.notifications.markFanoutDone(stored.id);
    delivered++;
  }
  return { planned: planned.length, delivered };
}
