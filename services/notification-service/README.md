# Notification Service

Tells users when an errand they are part of changes status — in the open tab, and (with their permission) as an OS notification on desktop and mobile even when the app is closed. Some notifications are interactive: the "delivered" alert has a **Confirm receipt** button.

Listens on port `3005`. It owns the `notifications` (inbox) and `pushSubscriptions` collections.

## How it fits together

```
Order Service ──(same atomic update as the transition)──▶ errand.notifyOutbox
      │  publish + confirm, relayed by the 20s sweep if the broker is down
      ▼
 RabbitMQ  errand.events  ──key: errand.status.changed──▶  notification.errand.status
                                                                  │  (retry 5×10s → …dead)
                                                                  ▼
                                                     Notification Service
                                                       1. rules: who is told what
                                                       2. inbox row (idempotent)
                                          ┌────────────┴─────────────┐
                                          ▼                           ▼
                                 SSE  /notifications/stream     Web Push (VAPID)
                                 (tab is open)                  (Chrome/Edge/Firefox/Safari, Android, iOS PWA)
                                          └────────────┬─────────────┘
                                                       ▼
                                  sw.js → OS notification (+ buttons) → click / action
```

Why two channels: SSE is instant and free but only works while a tab is open. Web Push reaches a closed browser/phone but is best-effort and needs permission. The inbox is the source of truth for both, and a reconnecting client catches up via `Last-Event-ID`.

Credit's settlement events (`errand.completed|cancelled|expired`) are untouched; the new event uses its own routing key that Credit does not bind.

## Who is told what

| Transition | Told |
| --- | --- |
| OPEN → ACCEPTED | requester |
| ACCEPTED → PICKED_UP | requester |
| PICKED_UP → PENDING_COMPLETION | requester (**high urgency, Confirm receipt button**) |
| PENDING_COMPLETION → COMPLETED | courier; if auto-completed by the sweep, requester too |
| ACCEPTED → CANCELLED (courier) | requester |
| ACCEPTED / PICKED_UP / PENDING_COMPLETION → DISPUTED (requester) | courier |
| PICKED_UP → DISPUTED (delivery deadline missed, by the sweep) | requester and courier |
| DISPUTED → CANCELLED (admin refunds) | requester and courier |
| DISPUTED → COMPLETED (admin pays the courier) | courier and requester |
| PICKED_UP → CANCELLED (deadline missed; older Order Services only) | requester and courier |
| OPEN → EXPIRED | requester |
| OPEN → CANCELLED (requester) | nobody (their own action) |

The acting user is never notified. Rules live in [src/domain/notification-rules.ts](src/domain/notification-rules.ts). Only one OS notification per errand is shown at a time (shared `tag`): a newer status replaces the older.

## HTTP API (cookie `access_token` or Bearer, like the other services)

| Method | Path | |
| --- | --- | --- |
| `GET` | `/notifications/vapid-public-key` | public; key the browser subscribes with. `503` if push is off |
| `GET` | `/notifications/stream` | SSE. Events: `ready`, `notification` (`id:` = notification id). Honors `Last-Event-ID` (replays up to 50) |
| `GET` | `/notifications?limit&before&unread=true` | inbox, newest first; `nextCursor` for paging |
| `GET` | `/notifications/unread-count` | `{ unread }` |
| `POST` | `/notifications/read` | `{ ids: [...≤100] }` or `{ all: true }` |
| `POST` | `/notifications/subscriptions` | `{ subscription: PushSubscription.toJSON() }` |
| `POST` | `/notifications/subscriptions/unsubscribe` | `{ endpoint }` — call on logout |

## Browser and device support

| Platform | Notifications when closed | Buttons |
| --- | --- | --- |
| Chrome / Edge / Brave (desktop, Android) | yes | yes (1–3, OS dependent) |
| Firefox (desktop, Android) | yes | Firefox 152+ |
| Safari macOS 13+ | yes | **no** (tap only) |
| iOS / iPadOS 16.4+ (Safari, Chrome, Edge) | **only if the app is added to the Home Screen** and opened from there | **no** |

Consequences built in: the worker feature-detects `Notification.maxActions` and shows as many buttons as fit; **tapping the notification must always do the right thing**, so every button has a tap-only equivalent (the errand screen). On iOS the frontend must show an "Add to Home Screen" hint (`NotificationClient.pushState()` returns `needs-install`) and the app needs a web manifest with `display: standalone`. Permission can only be requested from a user gesture. If a user denies, only the OS/browser settings can undo it.

## Interactive actions

The server decides which buttons a notification has ([types](src/types/notification.types.ts)); the service worker renders what the browser supports and runs `request` when tapped. Today: `view` (open the errand) and `confirm` (`POST /errands/:id/complete` straight from the worker using the session cookie).

**Decision for you:** one-tap confirm releases credits to the courier, so a mis-tap on a lock screen could confirm before the item is in hand. With `NOTIFY_DIRECT_ACTIONS=true` (the default) the delivered notification has **Confirm receipt**, which calls the Order Service from the service worker. With `NOTIFY_DIRECT_ACTIONS=false` it has **Review & confirm** instead: it only opens the app at `<APP_ERRAND_PATH>?review=<errandId>`, where the frontend shows a confirmation banner and the same "cannot be undone" prompt as the errand card. Nothing is paid out from the notification itself. If the direct call fails for any reason (expired session, offline, cross-site cookies) the worker opens the errand instead; it never refreshes the session itself because refresh tokens rotate and a refresh racing the page's own could invalidate the session. The worker only runs a hard-coded allowlist (`POST /errands/<id>/complete`) and only ever opens same-origin paths.

## Security notes

- **SSRF:** a push subscription endpoint is a URL this server POSTs to. Only `https` hosts on known push services are accepted ([src/security/push-endpoint.ts](src/security/push-endpoint.ts); override with `PUSH_ENDPOINT_ALLOWLIST`).
- **Shared browsers:** subscriptions are keyed by endpoint, so a different account registering on the same browser takes it over; clients must also call unsubscribe on logout. Max 10 devices per user (oldest evicted).
- Streams are closed every ~10 min (jittered) so a revoked session cannot keep a stream forever; clients reconnect and re-authenticate.
- Lock-screen text contains the supplier name and drop-off point. Review in `notification-rules.ts` if that is too much.
- Push payloads are end-to-end encrypted to the browser; the push vendor cannot read them.

## Configuration

| Env | |
| --- | --- |
| `JWT_SECRET`, `REDIS_URL` | same as the other services |
| `RABBITMQ_URL` | required |
| `MONGO_NOTIFICATION_SERVICE_PASSWORD`, `MONGO_HOST`, `MONGO_DB_NAME` | DB user `notification_service` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `npm run vapid:generate` **once per environment**; rotating them invalidates every existing subscription |
| `PUSH_DISABLED=true` | run SSE + inbox only (local dev without keys) |
| `APP_ERRAND_PATH` | frontend route for an errand, default `/errands/{id}` |
| `NOTIFY_DIRECT_ACTIONS` | `false` replaces one-tap Confirm receipt with Review & confirm (opens the app) |
| `FRONTEND_ORIGIN`, `PUSH_ENDPOINT_ALLOWLIST`, `PORT` | |

## Setup

1. Database: use the files in `migration-changes.zip` (`config/db.js` for fresh volumes; `config/migrations/notification-service.js` and `config/migrations/order-notify-outbox.js` for existing ones, loaded with mongosh from `/migrations`). Both need `MONGO_NOTIFICATION_SERVICE_PASSWORD` in the MongoDB container's environment.
2. `npm run vapid:generate` once, and put the three `VAPID_*` values in your `.env`.
3. Add the `notification-service` block from the supplied `compose.yaml`. Note `APP_ERRAND_PATH`: set it to wherever your frontend shows an errand.
4. Frontend: copy `client/sw.js` to the site root (`public/sw.js`), add icons at `/icons/icon-192.png` and `/icons/badge-72.png`, proxy `/notifications` to port 3005, and use `client/notifications.ts`. Web Push needs HTTPS (localhost is exempt).

Smoke test without the Order Service: `RABBITMQ_URL=… npm run dev:send-test-event -- <requesterUserId> <courierUserId> PENDING_COMPLETION`.

## Reliability

At-least-once end to end. Order writes the event into the errand document in the same atomic update as the status change and relays it until the broker confirms. Here the inbox row `(userId, eventId)` is the idempotency record, with a `fanoutDone` marker written *after* delivery, so a crash causes at most a duplicate push (which replaces itself via `tag`), never a lost one. Transient failures retry 5× at 10 s, then `notification.errand.status.dead`. Push failures never fail an event: 404/410 deletes the subscription, other failures count toward removal after 8 in a row, 401/403 (our VAPID config) is logged and never deletes anyone's device. If the queue has never been declared (service never started) status events are dropped by the broker rather than blocking Order; once the queue exists they are durable.

## Known limits / next steps

- SSE fan-out is in-memory: run **one replica**, or move `LiveHub` to Redis pub/sub before scaling out.
- No per-user preferences (mute, quiet hours) yet; the rules function is the place to add them.
- No deadline reminders ("confirm within 2 h"); would be a BullMQ delayed job in Order or here.
- Mongo stores and the RabbitMQ/Redis wiring are covered by type-checking and fakes, not by tests against real servers.

## Development

```sh
npm install
npm run dev
npm test               # 127 tests, no Mongo/RabbitMQ/Redis needed
npm run typecheck && npm run typecheck:tests
```
