// Tunables, read lazily so tests can change process.env between cases.
const DEFAULT_PUSH_HOSTS = [
  "fcm.googleapis.com",          // Chrome, Edge (Android/desktop), Brave, Opera, Samsung Internet
  "push.services.mozilla.com",   // Firefox (updates.push.services.mozilla.com, ...)
  "push.apple.com",              // Safari / iOS & iPadOS Home Screen web apps (web.push.apple.com)
  "notify.windows.com",          // Edge on Windows (WNS)
];

export const settings = {
  get rabbitmqUrl() { return process.env.RABBITMQ_URL ?? ""; },

  get vapidPublicKey() { return process.env.VAPID_PUBLIC_KEY ?? ""; },
  get vapidPrivateKey() { return process.env.VAPID_PRIVATE_KEY ?? ""; },
  // Push services may contact this address if our traffic misbehaves; must be mailto: or https:
  get vapidSubject() { return process.env.VAPID_SUBJECT ?? ""; },
  // Escape hatch for local work without keys: SSE + inbox keep working, Web Push is switched off.
  get pushDisabled() { return process.env.PUSH_DISABLED === "true"; },

  // Subscriptions are user-supplied URLs that this server will POST to, so only well-known push
  // services are accepted (SSRF guard). Comma-separated host suffixes override the default.
  get pushHostAllowlist(): string[] {
    const raw = process.env.PUSH_ENDPOINT_ALLOWLIST;
    return raw ? raw.split(",").map((h) => h.trim().toLowerCase()).filter(Boolean) : DEFAULT_PUSH_HOSTS;
  },

  // Where the frontend shows an errand; `{id}` is replaced with the errand id.
  get appErrandPath() { return process.env.APP_ERRAND_PATH ?? "/errands/{id}"; },

  // When false, the "Confirm receipt" button is not attached to notifications, so releasing
  // credits always happens inside the app. See README "Interactive actions".
  get directActions() { return process.env.NOTIFY_DIRECT_ACTIONS !== "false"; },

  get frontendOrigin() { return process.env.FRONTEND_ORIGIN ?? "http://localhost:5173"; },
};
