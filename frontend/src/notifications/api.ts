import { apiFetch, notificationApiUrl } from "../api/client.ts";
import type { AppNotification } from "./types.ts";

const JSON_HEADERS = { "Content-Type": "application/json" };

async function readJson<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) throw new Error(`${what} failed (HTTP ${response.status})`);
  return await response.json() as T;
}

export async function listNotifications(
  options: { limit?: number; before?: string; signal?: AbortSignal } = {},
): Promise<{ items: AppNotification[]; nextCursor: string | null }> {
  const query = new URLSearchParams();
  if (options.limit) query.set("limit", String(options.limit));
  if (options.before) query.set("before", options.before);
  const suffix = query.size ? `?${query}` : "";
  const response = await apiFetch(notificationApiUrl(`/notifications${suffix}`), {
    cache: "no-store",
    signal: options.signal,
  });
  const body = await readJson<{ items?: AppNotification[]; nextCursor?: string | null }>(response, "Listing notifications");
  if (!Array.isArray(body.items)) throw new Error("Notification list has an invalid shape");
  return { items: body.items, nextCursor: body.nextCursor ?? null };
}

export async function getUnreadCount(): Promise<number> {
  const response = await apiFetch(notificationApiUrl("/notifications/unread-count"), { cache: "no-store" });
  const body = await readJson<{ unread?: number }>(response, "Reading the unread count");
  if (!Number.isInteger(body.unread) || (body.unread as number) < 0) throw new Error("Unread count has an invalid shape");
  return body.unread as number;
}

async function postRead(payload: { ids: string[] } | { all: true }): Promise<number> {
  const response = await apiFetch(notificationApiUrl("/notifications/read"), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });
  const body = await readJson<{ unread?: number }>(response, "Marking notifications read");
  return Number.isInteger(body.unread) ? body.unread as number : 0;
}

/** Resolves to the server's new unread count. */
export const markNotificationsRead = (ids: string[]) => postRead({ ids });
export const markAllNotificationsRead = () => postRead({ all: true });

export async function fetchVapidPublicKey(): Promise<string> {
  const response = await apiFetch(notificationApiUrl("/notifications/vapid-public-key"));
  const body = await readJson<{ publicKey?: string }>(response, "Reading the push key");
  if (!body.publicKey) throw new Error("Push key is missing");
  return body.publicKey;
}

export async function saveSubscription(subscription: PushSubscriptionJSON): Promise<void> {
  const response = await apiFetch(notificationApiUrl("/notifications/subscriptions"), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ subscription }),
  });
  if (!response.ok) throw new Error(`Saving the push subscription failed (HTTP ${response.status})`);
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  const response = await apiFetch(notificationApiUrl("/notifications/subscriptions/unsubscribe"), {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ endpoint }),
  });
  if (!response.ok) throw new Error(`Removing the push subscription failed (HTTP ${response.status})`);
}
