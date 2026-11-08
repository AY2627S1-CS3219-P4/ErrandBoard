import type { StatusChangeEvent } from "../event/errand-status-event.js";
import type { NotificationAction, NotificationKind, RecipientRole, Urgency } from "../types/notification.types.js";

export interface PlannedNotification {
  recipientId: string;
  recipientRole: RecipientRole;
  kind: NotificationKind;
  title: string;
  body: string;
  urgency: Urgency;
  actions: NotificationAction[];
}

export interface RuleOptions {
  /** Offer the one-tap "Confirm receipt" button (see README "Interactive actions"). */
  directActions: boolean;
}

type Draft = Omit<PlannedNotification, "recipientId" | "recipientRole" | "urgency" | "actions"> &
  { urgency?: Urgency; extra?: NotificationAction[] };

// The Order Service route that the service worker calls when the button is tapped.
const confirmAction = (errandId: string): NotificationAction =>
  ({ action: "confirm", title: "Confirm receipt", request: { method: "POST", path: `/errands/${errandId}/complete` } });

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Timezone-free ("within 2 days") because the server cannot know the reader's timezone.
function window(deadline: string | null, from: string): string | null {
  if (!deadline) return null;
  const ms = Date.parse(deadline) - Date.parse(from);
  if (!(ms > 0)) return null;
  const hours = Math.round(ms / 3_600_000);
  return hours >= 24 ? plural(Math.round(hours / 24), "day") : plural(Math.max(1, hours), "hour");
}

/**
 * Decides who is told what about a status change.
 *
 * Principles: never notify the person who just did the thing; tell the *other* party; the sweep
 * (SYSTEM) affects both parties, so both are told. Self-initiated transitions with nothing to
 * report (e.g. requester cancels their own OPEN errand) produce nothing.
 */
export function planNotifications(ev: StatusChangeEvent["value"], opts: RuleOptions): PlannedNotification[] {
  const { status, previousStatus, actor, requesterId, courierId, credit, supplierName: shop, dropoff } = ev;
  const out: PlannedNotification[] = [];

  // `extra` buttons go before the universal "View errand": browsers that can only show one button
  // should show the most useful one.
  const VIEW: NotificationAction = { action: "view", title: "View errand" };
  const make = (role: RecipientRole, id: string, p: Draft): PlannedNotification =>
    ({ urgency: "normal", ...p, actions: [...(p.extra ?? []), VIEW], recipientId: id, recipientRole: role });
  const toRequester = (p: Draft) => out.push(make("REQUESTER", requesterId, p));
  const toCourier = (p: Draft) => { if (courierId) out.push(make("COURIER", courierId, p)); };

  switch (status) {
    case "ACCEPTED":
      toRequester({ kind: "ERRAND_ACCEPTED", title: "Errand accepted", body: `A courier accepted your ${shop} errand.` });
      break;

    case "PICKED_UP":
      toRequester({ kind: "ERRAND_PICKED_UP", title: "Order picked up", body: `Your courier collected your order from ${shop} and is heading to ${dropoff}.` });
      break;

    case "PENDING_COMPLETION": {
      const within = window(ev.deadline, ev.occurredAt);
      toRequester({
        kind: "ERRAND_DELIVERED",
        title: "Delivered — please confirm",
        body: `Your courier marked the ${shop} errand as delivered at ${dropoff}. ` +
          `Confirm${within ? ` within ${within}` : ""} to release ${plural(credit, "credit")}.`,
        urgency: "high",
        extra: opts.directActions ? [confirmAction(ev.errandId)] : [],
      });
      break;
    }

    case "COMPLETED":
      toCourier({ kind: "ERRAND_COMPLETED", title: "Errand completed", body: `${plural(credit, "credit")} for the ${shop} errand are on their way to you.` });
      if (actor.role === "SYSTEM") {
        toRequester({
          kind: "ERRAND_AUTO_COMPLETED",
          title: "Errand completed automatically",
          body: `You didn't confirm the ${shop} delivery in time, so ${plural(credit, "credit")} were released to your courier.`,
        });
      }
      break;

    case "CANCELLED":
      if (previousStatus === "ACCEPTED" && actor.role === "COURIER") {
        toRequester({ kind: "ERRAND_CANCELLED_BY_COURIER", title: "Courier cancelled", body: `Your courier cancelled the ${shop} errand. ${plural(credit, "credit")} are being refunded.` });
      } else if (previousStatus === "PICKED_UP" && actor.role === "SYSTEM") {
        toRequester({ kind: "ERRAND_CANCELLED_TIMEOUT", title: "Errand cancelled", body: `The ${shop} errand wasn't delivered in time and was cancelled. ${plural(credit, "credit")} are being refunded.` });
        toCourier({ kind: "ERRAND_CANCELLED_TIMEOUT", title: "Errand cancelled", body: `The delivery deadline for the ${shop} errand passed, so it was cancelled.` });
      }
      // OPEN -> CANCELLED is the requester's own action: nothing to tell anyone
      break;

    case "EXPIRED":
      toRequester({ kind: "ERRAND_EXPIRED", title: "Errand expired", body: `Nobody accepted your ${shop} errand in time. ${plural(credit, "credit")} are being refunded.` });
      break;

    default:
      break; // OPEN is never a transition target
  }

  return out.filter((n) => n.recipientId !== actor.userId);
}
