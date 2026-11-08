import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { useLeaveGuard } from "../components/leave-guard";
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationsRead,
} from "./api";
import { NotificationContext, type NotificationContextValue } from "./notification-context";
import {
  disablePush as turnOffPush,
  enablePush as turnOnPush,
  getPushState,
  isPushSubscribed,
  registerServiceWorker,
  syncPushSubscription,
  type PushState,
} from "./push";
import { openNotificationStream } from "./stream";
import { NOTIFICATION_RECEIVED_EVENT, type AppNotification } from "./types";

const PAGE_SIZE = 30;
const MAX_TOASTS = 3;

interface WorkerMessage {
  type?: string;
  url?: unknown;
  payload?: Partial<AppNotification>;
}

/** Owns the signed-in user's inbox, the live stream, and this browser's push state. Mount it inside RequireAuth. */
export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { shouldBlockLeave } = useLeaveGuard();
  const userId = user?.id;

  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState<AppNotification[]>([]);
  const [pushState, setPushState] = useState<PushState>(() => getPushState());
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState("");

  // Ids already shown, so the same notification arriving by stream AND by the service worker counts once.
  const seen = useRef(new Set<string>());
  // react-router's navigate changes identity on every navigation; keep the stream effect independent of it.
  const navigateRef = useRef(navigate);
  const shouldBlockLeaveRef = useRef(shouldBlockLeave);
  useEffect(() => {
    navigateRef.current = navigate;
    shouldBlockLeaveRef.current = shouldBlockLeave;
  });

  const refreshPushStatus = useCallback(async () => {
    setPushState(getPushState());
    setPushSubscribed(await isPushSubscribed());
  }, []);

  const reload = useCallback(() => {
    return Promise.all([listNotifications({ limit: PAGE_SIZE }), getUnreadCount()])
      .then(([page, count]) => {
        for (const item of page.items) seen.current.add(item.id);
        setItems(page.items);
        setHasMore(page.items.length >= PAGE_SIZE);
        setUnread(count);
        setError("");
      })
      .catch(() => setError("Notifications are temporarily unavailable."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!userId) return;

    const receive = (notification: AppNotification) => {
      if (seen.current.has(notification.id)) return;
      seen.current.add(notification.id);
      setItems((current) => [notification, ...current]);
      if (!notification.readAt) setUnread((count) => count + 1);
      // With permission granted the service worker shows an OS notification; otherwise tell them here.
      if (getPushState() !== "granted") {
        setToasts((current) => [notification, ...current].slice(0, MAX_TOASTS));
      }
      window.dispatchEvent(new CustomEvent(NOTIFICATION_RECEIVED_EVENT, { detail: notification }));
    };

    const onWorkerMessage = (event: MessageEvent<WorkerMessage | null>) => {
      const message = event.data;
      if (message?.type === "navigate" && typeof message.url === "string") {
        // Same courtesy as the sidebar links: a page with unsaved work can refuse to be left.
        if (!shouldBlockLeaveRef.current()) navigateRef.current(message.url);
      } else if (message?.type === "notification" && typeof message.payload?.id === "string") {
        const { payload } = message;
        receive({
          id: payload.id as string,
          kind: payload.kind ?? "",
          title: payload.title ?? "ErrandBoard",
          body: payload.body ?? "",
          url: payload.url ?? "/errands/active",
          errandId: payload.errandId ?? "",
          urgency: payload.urgency === "high" ? "high" : "normal",
          actions: payload.actions ?? [],
          occurredAt: payload.occurredAt ?? new Date().toISOString(),
          readAt: null,
        });
      }
    };

    void reload();
    const closeStream = openNotificationStream({
      onNotification: receive,
      onReady: (reconnect) => { if (reconnect) void reload(); }, // pick up anything missed while disconnected
    });
    navigator.serviceWorker?.addEventListener("message", onWorkerMessage);

    // Bind an existing permission grant to whoever is signed in now, then show the true state.
    void registerServiceWorker()
      .then(() => syncPushSubscription())
      .catch(() => undefined)
      .finally(() => { void refreshPushStatus(); });

    // The user may change the permission in browser settings while the app is open.
    const onFocus = () => { void refreshPushStatus(); };
    window.addEventListener("focus", onFocus);

    return () => {
      closeStream();
      navigator.serviceWorker?.removeEventListener("message", onWorkerMessage);
      window.removeEventListener("focus", onFocus);
    };
  }, [userId, reload, refreshPushStatus]);

  const loadMore = useCallback(async () => {
    const before = items[items.length - 1]?.id;
    if (!before) return;
    try {
      const page = await listNotifications({ limit: PAGE_SIZE, before });
      for (const item of page.items) seen.current.add(item.id);
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((c) => c.id === item.id))]);
      setHasMore(page.items.length >= PAGE_SIZE);
    } catch {
      setError("Could not load older notifications.");
    }
  }, [items]);

  const markRead = useCallback(async (ids: string[]) => {
    const now = new Date().toISOString();
    setItems((current) => current.map((item) => (ids.includes(item.id) && !item.readAt ? { ...item, readAt: now } : item)));
    try {
      setUnread(await markNotificationsRead(ids));
    } catch {
      void reload(); // our optimistic copy may be wrong
    }
  }, [reload]);

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    setItems((current) => current.map((item) => (item.readAt ? item : { ...item, readAt: now })));
    try {
      setUnread(await markAllNotificationsRead());
    } catch {
      void reload();
    }
  }, [reload]);

  const enablePush = useCallback(async () => {
    setPushBusy(true);
    setPushError("");
    try {
      await turnOnPush();
    } catch {
      setPushError("Could not turn on notifications. Please try again.");
    } finally {
      await refreshPushStatus();
      setPushBusy(false);
    }
  }, [refreshPushStatus]);

  const disablePush = useCallback(async () => {
    setPushBusy(true);
    setPushError("");
    try {
      await turnOffPush();
    } catch {
      setPushError("Could not turn off notifications. Please try again.");
    } finally {
      await refreshPushStatus();
      setPushBusy(false);
    }
  }, [refreshPushStatus]);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const value = useMemo<NotificationContextValue>(() => ({
    items, unread, hasMore, loading, error, toasts, pushState, pushSubscribed, pushBusy, pushError,
    loadMore, markRead, markAllRead, enablePush, disablePush, dismissToast,
  }), [
    items, unread, hasMore, loading, error, toasts, pushState, pushSubscribed, pushBusy, pushError,
    loadMore, markRead, markAllRead, enablePush, disablePush, dismissToast,
  ]);

  return <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>;
}
