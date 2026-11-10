import { Link } from "react-router-dom";
import PushPanel from "../notifications/PushPanel";
import { useNotifications } from "../notifications/useNotifications";
import "../notifications/Notifications.css";
import { useAuth } from "../auth/useAuth";
import { useCreditBalance } from "../hooks/useCreditBalance";
import "./Settings.css";
import "./Homepage.css";

function formatWhen(iso: string): string {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function Homepage() {
    const { user } = useAuth();
    const { available, reserved, ready, unavailable } = useCreditBalance(user?.id);
    const { items, unread, hasMore, loading, error, loadMore, markRead, markAllRead } = useNotifications();

    const showUnavailable = unavailable;
    const showBalance = ready && !unavailable && available !== null && reserved !== null;

    return (
        <main className="settings-shell">
            <header className="app-page-header">
                <span />
                <h1>Home</h1>
                <span />
            </header>
            <div className="homepage-content">
                <section className="home-card home-credits" aria-labelledby="home-credits-heading">
                    <h2 id="home-credits-heading" className="home-card-title">Your credits</h2>
                    {showUnavailable ? (
                        <p className="home-credits-unavailable" role="status">
                            Credits are temporarily unavailable. Please try again shortly.
                        </p>
                    ) : showBalance ? (
                        <div className="home-credits-grid">
                            <div className="home-credit-stat">
                                <span className="home-credit-value">{available}</span>
                                <span className="home-credit-label">Available</span>
                            </div>
                            <div className="home-credit-stat">
                                <span className="home-credit-value">{reserved}</span>
                                <span className="home-credit-label">Reserved</span>
                            </div>
                        </div>
                    ) : (
                        <p className="home-credits-loading" role="status">Loading credits…</p>
                    )}
                </section>

                <section className="home-actions" aria-label="Quick actions">
                    <Link to="/suppliers" className="home-card home-action-card">
                        <span className="home-action-title">View suppliers</span>
                        <span className="home-action-desc">Browse suppliers and request an errand.</span>
                    </Link>
                    <Link to="/errands" className="home-card home-action-card">
                        <span className="home-action-title">Accept an errand</span>
                        <span className="home-action-desc">Find open errands you can take on.</span>
                    </Link>
                </section>

                <section className="home-inbox" aria-labelledby="home-inbox-heading">
                    <div className="home-inbox-header">
                        <h2 id="home-inbox-heading" className="home-card-title">Notifications</h2>
                        <button className="settings-logout-button notifications-mark-all" type="button"
                            onClick={() => void markAllRead()} disabled={unread === 0}>
                            Mark all read
                        </button>
                    </div>

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
                </section>
            </div>
        </main>
    );
}
