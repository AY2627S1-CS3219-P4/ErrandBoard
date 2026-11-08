export interface NotificationAction {
  action: string;
  title: string;
  /** App path this button opens (e.g. "Review & confirm"). Buttons without one only act from the OS notification. */
  url?: string;
}

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  /** App path to open when the notification is tapped. */
  url: string;
  errandId: string;
  recipientRole?: "REQUESTER" | "COURIER";
  urgency: "normal" | "high";
  actions: NotificationAction[];
  occurredAt: string;
  readAt: string | null;
}

/** Fired on window for every new notification, so pages can refresh themselves. */
export const NOTIFICATION_RECEIVED_EVENT = "errandboard:notification-received";
