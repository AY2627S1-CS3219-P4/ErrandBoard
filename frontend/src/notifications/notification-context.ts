import { createContext } from "react";
import type { PushState } from "./push";
import type { AppNotification } from "./types";

export interface NotificationContextValue {
  items: AppNotification[];
  unread: number;
  hasMore: boolean;
  loading: boolean;
  /** Set when the inbox could not be loaded; the live stream may still work. */
  error: string;
  /** New notifications to show in-app, only when no OS notification will appear for them. */
  toasts: AppNotification[];
  pushState: PushState;
  /** True when THIS browser currently has an active push subscription. */
  pushSubscribed: boolean;
  pushBusy: boolean;
  pushError: string;
  loadMore: () => Promise<void>;
  markRead: (ids: string[]) => Promise<void>;
  markAllRead: () => Promise<void>;
  enablePush: () => Promise<void>;
  disablePush: () => Promise<void>;
  dismissToast: (id: string) => void;
}

export const NotificationContext = createContext<NotificationContextValue | null>(null);
