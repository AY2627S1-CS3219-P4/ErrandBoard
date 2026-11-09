import { Router, type Request, type Response } from "express";
import { settings } from "../config/settings.js";
import { authenticate } from "../middleware/auth.middleware.js";
import { isAllowedPushEndpoint, isValidSubscriptionKeys } from "../security/push-endpoint.js";
import type { LiveHub } from "../services/live-hub.js";
import type { NotificationStore, SubscriptionStore } from "../types/notification.types.js";

//RouterDeps is the interface which handles notifications stored, subscriptions stored and the livehub
export interface RouterDeps {
  notifications: NotificationStore;
  subscriptions: SubscriptionStore;
  hub: LiveHub;
  pushEnabled: boolean;
}

//utility functions
const OBJECT_ID = /^[0-9a-f]{24}$/i;
const bad = (res: Response, code: string, error: string, status = 400) => { res.status(status).json({ code, error }); };

function limitFrom(value: unknown, fallback = 30, max = 100): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
}


export function createNotificationRouter(deps: RouterDeps): Router {
  const router = Router();

  //get vapid public-key no auth required, reject if push not configured
  router.get("/vapid-public-key", (_req, res) => {
    if (!deps.pushEnabled) return bad(res, "PUSH_NOT_CONFIGURED", "Web Push is not enabled", 503);

    res.json({ publicKey: settings.vapidPublicKey });
  });

  //everything else requires a valid logged in user
  router.use(authenticate);
  const me = (req: Request) => req.user!.userId; 

  //
  router.get("/stream", async (req, res) => {
    const userId = me(req);
    deps.hub.subscribe(userId, res);
    const last = req.get("Last-Event-ID");

    if (last && OBJECT_ID.test(last)) {
      // subscribe first, replay second: see LiveHub.replay
      deps.hub.replay(res, await deps.notifications.since(userId, last, 50));
    }
  });

  //notification inbox this is the source of "truth", the frontedn calls this on first load or reconnect to update the list
  //SSE and web push append to the list on the frontend
  //in the unlikely event a notification is dropped, on reconnect the frontend can still get the updated notifications list from here 
  router.get("/", async (req, res) => {
    const before = typeof req.query.before === "string" && OBJECT_ID.test(req.query.before) ? req.query.before : undefined;
    
    const items = await deps.notifications.list(me(req), {
      limit: limitFrom(req.query.limit),
      before,
      unreadOnly: req.query.unread === "true",
    });
    
    res.json({ items, nextCursor: items.length ? items[items.length - 1].id : null });
  });

  router.get("/unread-count", async (req, res) => {
    res.json({ unread: await deps.notifications.unreadCount(me(req)) });
  });

  router.post("/read", async (req, res) => {
    const { ids, all } = (req.body ?? {}) as { ids?: unknown; all?: unknown };
    
    let updated: number;
    
    if (all === true) {
      updated = await deps.notifications.markAllRead(me(req));
    } else if (Array.isArray(ids) && ids.length > 0 && ids.length <= 100 && ids.every((i) => typeof i === "string" && OBJECT_ID.test(i))) {
      updated = await deps.notifications.markRead(me(req), ids as string[]);
    } else {
      return bad(res, "VALIDATION_FAILED", "Provide { all: true } or { ids: [up to 100 notification ids] }");
    }
    
    res.json({ updated, unread: await deps.notifications.unreadCount(me(req)) });
  });


  //Web Push subscriptions 
  router.post("/subscriptions", async (req, res) => {

    if (!deps.pushEnabled) return bad(res, "PUSH_NOT_CONFIGURED", "Web Push is not enabled", 503);

    const sub = (req.body as { subscription?: { endpoint?: unknown; keys?: unknown; expirationTime?: unknown } } | undefined)?.subscription;
    
    if (!sub || !isAllowedPushEndpoint(sub.endpoint, settings.pushHostAllowlist)) {
      return bad(res, "INVALID_SUBSCRIPTION", "subscription.endpoint must be an https URL on a recognised push service");
    }
    
    if (!isValidSubscriptionKeys(sub.keys)) {
      return bad(res, "INVALID_SUBSCRIPTION", "subscription.keys.p256dh and subscription.keys.auth are required");
    }
    
    await deps.subscriptions.upsert(
      me(req),
      { endpoint: sub.endpoint, keys: sub.keys, expirationTime: typeof sub.expirationTime === "number" ? sub.expirationTime : null },
      req.get("user-agent") ?? undefined,
    );
    
    res.status(201).json({ ok: true });
  });

  // POST rather than DELETE-with-body, and not a query string: the endpoint URL is a capability
  // (whoever has it can address this browser) and must stay out of access logs.
  router.post("/subscriptions/unsubscribe", async (req, res) => {
    const endpoint = (req.body as { endpoint?: unknown } | undefined)?.endpoint;
    if (typeof endpoint !== "string" || endpoint.length > 2048) return bad(res, "VALIDATION_FAILED", "endpoint is required");
    res.json({ removed: await deps.subscriptions.remove(me(req), endpoint) });
  });

  return router;
}