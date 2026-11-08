import { useNotifications } from "./useNotifications";
import "./Notifications.css";

/** Lets the user turn OS notifications on or off for this device, and explains why they might not be available. */
export default function PushPanel({ showTitle = true }: { showTitle?: boolean }) {
  const { pushState, pushSubscribed, pushBusy, pushError, enablePush, disablePush } = useNotifications();

  let message: string;
  let action: { label: string; busyLabel: string; run: () => Promise<void> } | null = null;

  if (pushState === "unsupported") {
    message = "This browser or connection can't receive push notifications (they need a supported browser and a secure HTTPS connection). You'll still see updates here while ErrandBoard is open.";
  } else if (pushState === "needs-install") {
    message = "On iPhone and iPad, notifications only work for apps on your Home Screen. Tap Share, then Add to Home Screen, and open ErrandBoard from there to turn them on.";
  } else if (pushState === "denied") {
    message = "Notifications are blocked for this site. Allow them in your browser's site settings, then come back here.";
  } else if (pushState === "granted" && pushSubscribed) {
    message = "Notifications are on for this device. You'll be told when an errand you're part of changes, even if ErrandBoard is closed.";
    action = { label: "Turn off", busyLabel: "Turning off…", run: disablePush };
  } else {
    message = "Get a notification on this device when an errand you're part of changes, even if ErrandBoard is closed.";
    action = { label: "Turn on notifications", busyLabel: "Turning on…", run: enablePush };
  }

  return (
    <section className="push-panel" aria-labelledby={showTitle ? "push-panel-title" : undefined}
      aria-label={showTitle ? undefined : "Device notifications"}>
      {showTitle && <h2 id="push-panel-title" className="push-panel-title">Device notifications</h2>}
      <p className="push-panel-text">{message}</p>
      {action && (
        <button className="push-panel-button" type="button" onClick={() => void action.run()} disabled={pushBusy}>
          {pushBusy ? action.busyLabel : action.label}
        </button>
      )}
      {pushError && <p className="push-panel-error" role="alert">{pushError}</p>}
    </section>
  );
}
