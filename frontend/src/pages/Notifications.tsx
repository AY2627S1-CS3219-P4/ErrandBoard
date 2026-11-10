import { Link } from "react-router-dom";
import PushPanel from "../notifications/PushPanel";
import { useNotifications } from "../notifications/useNotifications";
import "../notifications/Notifications.css";

function formatWhen(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function Notifications() {
  const { items, unread, hasMore, loading, error, loadMore, markRead, markAllRead } = useNotifications();

  return (
    <main className="notifications-page">
      <header className="app-page-header">
        <span />
        <h1>Notifications</h1>
        <button className="settings-logout-button notifications-mark-all" type="button"
          onClick={() => void markAllRead()} disabled={unread === 0}>
          Mark all read
        </button>
      </header>

      <PushPanel />

      {loading && <p className="notifications-status">Loading notifications…</p>}
      {error && <p className="notifications-error" role="alert">{error}</p>}
      {!loading && !error && items.length === 0 && (
        <p className="notifications-status">
          Nothing yet. You'll see updates here when an errand you requested or accepted changes.
        </p>
      )}

      <ul className="notifications-list">
        {items.map((item) => {
          const isUnread = !item.readAt;
          const markThisRead = () => { if (isUnread) void markRead([item.id]); };
          // Buttons that open the app at their own path (e.g. "Review & confirm") are shown as links here;
          // OS-only buttons are not, because the errand may have moved on since.
          const links = item.actions.filter((action) => action.url);
          return (
            <li key={item.id} className={`notification-item${isUnread ? " notification-item-unread" : ""}`}>
              <Link className="notification-item-main" to={item.url} onClick={markThisRead}>
                <span className="notification-item-title">
                  {isUnread && <span className="notification-dot" aria-label="Unread" />}
                  {item.title}
                </span>
                <span className="notification-item-body">{item.body}</span>
                <time className="notification-item-time" dateTime={item.occurredAt}>{formatWhen(item.occurredAt)}</time>
              </Link>
              {links.length > 0 && (
                <div className="notification-item-actions">
                  {links.map((action) => (
                    <Link key={action.action} className="notification-item-action" to={action.url as string} onClick={markThisRead}>
                      {action.title}
                    </Link>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {hasMore && (
        <button className="settings-link notifications-more" type="button" onClick={() => void loadMore()}>
          Load older
        </button>
      )}
    </main>
  );
}
