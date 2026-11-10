import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useNotifications } from "./useNotifications";
import type { AppNotification } from "./types";
import "./Notifications.css";

const TOAST_MS = 8_000;

function Toast({ notification, onDismiss }: { notification: AppNotification; onDismiss: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, TOAST_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <li className="notification-toast">
      <Link className="notification-toast-link" to={notification.url} onClick={onDismiss}>
        <strong>{notification.title}</strong>
        <span>{notification.body}</span>
      </Link>
      <button className="notification-toast-close" type="button" onClick={onDismiss} aria-label="Dismiss notification">×</button>
    </li>
  );
}

/** In-app banners, shown only when the device is not going to show its own notification. */
export default function NotificationToasts() {
  const { toasts, dismissToast } = useNotifications();
  return (
    <ul className="notification-toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <Toast key={toast.id} notification={toast} onDismiss={() => dismissToast(toast.id)} />
      ))}
    </ul>
  );
}
