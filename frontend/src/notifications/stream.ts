import { apiFetch, notificationApiUrl } from "../api/client.ts";
import type { AppNotification } from "./types.ts";

export const STREAM_RECONNECT_DELAY_MS = 5_000;

export interface StreamHandlers {
  onNotification: (notification: AppNotification) => void;
  /** `reconnect` is false for the first connection and true afterwards; re-sync anything missed. */
  onReady?: (reconnect: boolean) => void;
}

function parseNotification(data: string): AppNotification | null {
  try {
    const value = JSON.parse(data) as Partial<AppNotification> | null;
    return value && typeof value.id === "string" && typeof value.title === "string" ? value as AppNotification : null;
  } catch {
    return null;
  }
}

/** Opens the live notification stream and keeps it open. Returns a function that closes it. */
export function openNotificationStream(handlers: StreamHandlers): () => void {
  let active = true;
  let source: EventSource | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let everReady = false;
  let recovering = false;

  const connect = () => {
    if (!active) return;
    const current = new EventSource(notificationApiUrl("/notifications/stream"), { withCredentials: true });
    source = current;

    current.addEventListener("ready", () => {
      handlers.onReady?.(everReady);
      everReady = true;
    });
    current.addEventListener("notification", (event) => {
      const notification = parseNotification((event as MessageEvent<string>).data);
      if (notification) handlers.onNotification(notification);
    });
    current.onerror = () => {
      // The server ends each stream after ~10 minutes (to re-authenticate). While the source is merely
      // CONNECTING the browser retries by itself and resumes from Last-Event-ID, so leave it alone.
      // Only a CLOSED source (e.g. a 401 once the 15-minute access cookie expired) needs us.
      if (current.readyState !== EventSource.CLOSED || recovering) return;
      current.close();
      recovering = true;
      // Any API call refreshes an expired access cookie through apiFetch before the stream is reopened.
      void apiFetch(notificationApiUrl("/notifications/unread-count"))
        .catch(() => undefined)
        .finally(() => {
          if (!active) return;
          timer = setTimeout(() => {
            timer = undefined;
            recovering = false;
            connect();
          }, STREAM_RECONNECT_DELAY_MS);
        });
    };
  };

  connect();
  return () => {
    active = false;
    source?.close();
    if (timer !== undefined) clearTimeout(timer);
  };
}
