# Order Service

Owns the errand lifecycle for ErrandBoard. A requester posts an errand against a supplier, a courier accepts and fulfils it, and the service drives the state machine from `OPEN` through to a terminal state. It owns the `errands` collection in the `errandboard` MongoDB database and publishes terminal errand events for the Credit Service consumer to settle against.

The service listens on port `3003`. Inside Compose other services reach it at `http://order-service:3003`; the port is also published to the host for local development.

## Responsibilities

- Create errands, reserving credit from Credit Service before the errand becomes visible.
- Serve the open-errand board (with filtering) and a user's own active errands.
- Apply status transitions requested by the acting requester or courier, enforcing ownership and valid transitions atomically.
- Expire, auto-dispute, and auto-complete errands past their deadlines through a recurring background sweep.
- Let a requester (or the sweep) dispute an undelivered errand, holding its credits until an admin resolves it.
- Publish `errand.completed`, `errand.cancelled`, and `errand.expired` events so credits are transferred or refunded exactly once, retrying delivery until the broker accepts each event.

## Errand lifecycle

Statuses are defined in [src/status/errandState.ts](src/status/errandState.ts). Every transition goes through a single conditional `findOneAndUpdate`, so the status check and the write are one atomic operation.

```
OPEN ──accept──▶ ACCEPTED ──pickup──▶ PICKED_UP ──deliver──▶ PENDING_COMPLETION ──complete──▶ COMPLETED
 │                  │   │                 │   │                                               (terminal)
 │ cancel           │   │ dispute         │   │ dispute
 ▼                  │   ▼                 │   ▼                │ (sweep after deliverBy) ──▶ DISPUTED
CANCELLED ◀─────────┘  DISPUTED ◀─────────┘  DISPUTED         │
 (terminal)             │                                     ▼ (sweep after confirmBy) ──▶ COMPLETED
 │ (sweep after         │ admin resolve ──▶ CANCELLED (refund requester)
 │  expiresAt)          └ admin resolve ──▶ COMPLETED (transfer to courier)
 ▼
EXPIRED (terminal)      (courier-cancel also moves ACCEPTED ──▶ CANCELLED)
```

- `accept` — a courier claims an `OPEN` errand. A requester cannot accept their own errand, an already-assigned errand cannot be reassigned, and an expired errand cannot be accepted. Sets `courierId`.
- `pickup` — the assigned courier marks collection, setting `deliverBy` (5 days out).
- `deliver` — the assigned courier marks delivery before `deliverBy`, setting `confirmBy` (2 days out) and moving to `PENDING_COMPLETION`.
- `complete` — the requester confirms receipt.
- `cancel` / `courier-cancel` — the requester cancels an `OPEN` errand, or the courier cancels one they `ACCEPTED`.
- `dispute` — the requester flags an errand that is `ACCEPTED`, `PICKED_UP`, or `PENDING_COMPLETION` (the courier marked it delivered but the item was unsatisfactory). A `PENDING_COMPLETION` errand can be disputed only while its confirmation window is still open (`confirmBy > now`); once that passes the sweep auto-completes and pays the courier. The errand moves to **`DISPUTED`**, a non-terminal **held** state: no event is emitted and the reserved credits stay frozen. The sweep also auto-disputes a `PICKED_UP` errand once `deliverBy` passes (reason "Delivery deadline passed").
- `resolve-refund` / `resolve-transfer` — an **admin** resolves a `DISPUTED` errand, driving it to `CANCELLED` (refund the requester) or `COMPLETED` (transfer to the courier). These reuse the ordinary terminal transitions, so they emit the usual `errand.cancelled` / `errand.completed` events and the Credit Service settles them with no special casing.

Deadlines: `EXPIRY_DEADLINE` and `CONFIRMATION_DEADLINE` are 2 days; `DELIVERY_DEADLINE` is 5 days (in [src/services/order.services.ts](src/services/order.services.ts)).

## HTTP API

All routes are mounted under `/errands` and require authentication ([src/routes/order.routes.ts](src/routes/order.routes.ts)). `GET /health` is the only unauthenticated endpoint.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/errands` | List `OPEN`, unexpired errands. Query filters: `supplierId`, `building`, `address` (repeatable, exact match), `dropoff`, `q` (substring), `since` (ISO date). |
| `GET` | `/errands/mine` | The caller's active and disputed errands (as requester or courier), newest first. |
| `GET` | `/errands/disputes` | **Admin only.** Every `DISPUTED` errand, oldest dispute first (the resolution queue). |
| `GET` | `/errands/:id` | A single errand. Visible only to the involved requester/courier, or if it is an open public listing. |
| `POST` | `/errands` | Create an errand. Body: `supplierId`, `dropoff`, `description`, `credit`. |
| `POST` | `/errands/:id/accept` | Courier accepts. |
| `POST` | `/errands/:id/pickup` | Courier marks picked up. |
| `POST` | `/errands/:id/deliver` | Courier marks delivered. |
| `POST` | `/errands/:id/complete` | Requester confirms completion. |
| `POST` | `/errands/:id/cancel` | Requester cancels an open errand. |
| `POST` | `/errands/:id/courier-cancel` | Courier cancels an accepted errand. |
| `POST` | `/errands/:id/dispute` | Requester disputes an `ACCEPTED`/`PICKED_UP`/`PENDING_COMPLETION` errand (the last only while `confirmBy` is open). Body: `reason` (required, ≤300 chars). Moves it to `DISPUTED`; no credit change. |
| `POST` | `/errands/:id/resolve-refund` | **Admin only.** Resolve a `DISPUTED` errand by refunding the requester (→ `CANCELLED`). |
| `POST` | `/errands/:id/resolve-transfer` | **Admin only.** Resolve a `DISPUTED` errand by paying the courier (→ `COMPLETED`). |

The acting user is always the authenticated subject; the client never supplies a requester or courier id on a transition. The admin dispute routes (`GET /errands/disputes`, `resolve-refund`, `resolve-transfer`) additionally require an `ADMIN` or `SUPERADMIN` role, enforced by the `requireAdmin` middleware ([src/middleware/auth.middleware.ts](src/middleware/auth.middleware.ts)) after `authenticate`; a non-admin gets `403`. Errors are returned as `{ code, error, fields? }`; the mapping from domain error to HTTP status lives in [src/controller/order.controller.ts](src/controller/order.controller.ts) (e.g. `VALIDATION_FAILED` 400, `ERRAND_NOT_FOUND` 404, `SELF_ASSIGN` 403, `DEADLINE_PASSED`/`UPDATE_CONFLICT` 409, `INSUFFICIENT_CREDITS` 400, `SUPPLIER_UNAVAILABLE`/`SERVICE_UPSTREAM_ERROR` 503).

## Authentication & authorization

Requests carry the short-lived `access_token` (HttpOnly cookie used by the frontend, or a `Bearer` token for trusted clients). The token is verified with the shared `JWT_SECRET` ([src/security/token.ts](src/security/token.ts)), then the current role, authorization version, and active/blocked state are checked in Redis before any database read ([src/security/authorization-state.ts](src/security/authorization-state.ts)). Missing or unreachable authorization state fails closed (`503`); revoked or inactive accounts are denied. This mirrors the User and Supplier services.

## Upstream dependencies

Errand creation is synchronous and ordered:

1. **Supplier Service** (`SUPPLIER_SERVICE_URL`) — the supplier is looked up and must be active. Only the `supplierId` comes from the client; the stored supplier name/building/address are copied from the response ([src/clients/supplier.client.ts](src/clients/supplier.client.ts)).
2. **Credit Service** (`CREDIT_SERVICE_URL`) — credit is reserved against the pre-allocated order id before the errand document is written, authenticated with `ORDER_CREDIT_API_KEY` ([src/clients/credit.client.ts](src/clients/credit.client.ts)). The `orderId` is stable so the reservation is idempotent on retry. Order queries Credit's internal reservation-status API after an uncertain reply; only a matching confirmed reservation permits Errand creation.

Both upstream calls time out after 3s. An unavailable supplier or an unresolved Credit outcome surfaces as `503`; a confirmed domain rejection retains its specific error code.

### Creation recovery and compensation

After validating the supplier and Errand fields, Order writes an `orderCreation` intent **before** requesting the reservation. The intent and Errand share an ObjectId. Inserting the `OPEN` Errand and marking the intent `COMPLETED` happen in one MongoDB transaction ([src/services/order-creation.service.ts](src/services/order-creation.service.ts)). Order does not read or write Credit's MongoDB collections directly.

If the reservation outcome remains unknown, Order returns `503 ORDER_CREATION_PENDING` and keeps the intent. A failed Errand write is also treated as uncertain: the request checks whether the Errand committed, but does not refund credits itself. The background worker first claims the intent, fencing off a late Errand transaction, then checks both the Errand and Credit reservation before releasing an orphaned reservation through Credit's internal API. A matching reservation can be released idempotently; conflicting Credit outcomes are left for manual reconciliation.

An intent normally gets a 60-second in-flight grace period; a failed request can make it due immediately. Transient recovery failures retry with exponential delays capped at five minutes. `COMPENSATED` means no Errand exists and no reservation remains; `RECONCILE` marks an incompatible state requiring human review. Never silently create another order or refund a `RECONCILE` intent. A browser receiving `ORDER_CREATION_PENDING` should check My Errands before trying to submit the same details again, because the original creation may have succeeded.

## Events

On reaching a terminal state, events are published to the `errand.events` topic exchange on RabbitMQ (`RABBITMQ_URL`). `DISPUTED` is **not** terminal, so disputing an errand emits **no** event and its credits stay reserved; the terminal event is emitted only when an admin resolves the dispute (which reuses the ordinary `CANCELLED`/`COMPLETED` transitions), so the event payload and the Credit Service's dedupe key are unchanged. The event type is one of `errand.completed`, `errand.cancelled`, `errand.expired`; the payload carries `eventId` (`<errandId>:<type>`), `cause`, `requesterId`, `courierId`, `credit`, and `occurredAt`. The `cause` field records **why** the errand reached its terminal state — `CONFIRMED`, `AUTO_CONFIRMED`, `REQUESTER_CANCELLED`, `COURIER_CANCELLED`, `EXPIRED`, `DISPUTE_REFUNDED`, or `DISPUTE_TRANSFERRED` — so a notification consumer can tell a dispute outcome apart from an ordinary completion or cancellation. It is persisted on the errand as `terminalCause` (so the outbox relay rebuilds the same payload after a broker outage) and the Credit Service ignores it. Because an errand reaches a terminal state exactly once, the errand id is used as the routing key and the event id doubles as the consumer's dedupe key. See [src/event/](src/event/). Credit Service binds its own durable queues to this exchange to refund or transfer credits.

### Reliable delivery (transactional outbox)

Event delivery is tied to the errand row so a broker outage can never silently drop a settlement. The same atomic transition that moves an errand to a terminal state also sets an `eventPending` flag on the document ([src/services/order.services.ts](src/services/order.services.ts)). The service then tries to publish; only on a confirmed publish is `eventPending` cleared — and that clear is written with `timestamps: false` so it does not bump `updatedAt`, which feeds `occurredAt` ([src/event/errand.events.ts](src/event/errand.events.ts)).

If publishing fails, the flag is left set and the event is retried on the next lifecycle sweep tick, which calls `flushPendingEvents()` to re-publish pending errands oldest-first (up to 200 per tick), stopping early when the broker still looks down. A partial index on `eventPending` keeps that scan cheap ([src/models/Errand.ts](src/models/Errand.ts)).

The publisher uses publisher confirms over an `amqp-connection-manager` channel and publishes each message `persistent` and `mandatory` ([src/event/rabbit.publisher.ts](src/event/rabbit.publisher.ts)). A broker `return` (no queue bound) surfaces as `UnroutableError` and a confirm failure as `PublishError`; both leave the event pending for the next retry rather than being treated as delivered.

A terminal Errand with `eventPending: true` for over two minutes emits a backlog warning. Credit consumes terminal events with its own retry queue and moves permanently rejected events to `credit.errand.events.dead`. For an incident, inspect Order's pending intents and terminal events as well as RabbitMQ's queue counts:

```sh
docker compose exec rabbitmq rabbitmqctl list_queues name messages_ready messages_unacknowledged
```

Inspect a dead-lettered event and the Credit operation log before any manual replay. Preserve the original `eventId` to retain Credit's idempotency protection; do not purge a queue merely to clear an alert.

### Status events for notifications

Every transition (not just terminal ones) also publishes `errand.status.changed` to the same exchange for the Notification Service. The payload carries `eventId` (`<errandId>:status:<STATUS>`), `status`, `previousStatus`, `actor` (`REQUESTER`/`COURIER`/`SYSTEM`), both user ids, `credit`, supplier name, drop-off, optional `deadline`, and `occurredAt`. Credit does not bind this routing key, so settlement is unaffected.

It uses its own outbox, independent of `eventPending`: `updateErrand` `$push`es an entry onto `errand.notifyOutbox` and sets `notifyPending` in the **same atomic update** as the status change, publishes immediately, `$pull`s each confirmed entry, and the sweep relays leftovers ([src/event/status.events.ts](src/event/status.events.ts)). Entries publish in order per errand and stop at the first failure. Unlike settlement events these are published non-`mandatory`: if the notification queue has never been declared the broker drops them rather than wedging the relay. Delivery is at-least-once; the consumer dedupes on `eventId`.

Existing MongoDB volumes need the partial index (Order runs with `autoIndex: false`): `.load("/migrations/order-notify-outbox.js")`.

## Background lifecycle sweep

A BullMQ repeatable job (`errand-lifecycle`, backed by Redis) runs every 20s ([src/queue/queue.ts](src/queue/queue.ts)). Each tick ([src/queue/sweep.ts](src/queue/sweep.ts)) first relays any events still pending from earlier failures (see [Reliable delivery](#reliable-delivery-transactional-outbox)), then processes up to 200 due creation intents, and finally finds errands whose deadline has passed and drives them to the correct terminal state — up to 200 per status per tick, the rest wait for the next tick:

- `OPEN` past `expiresAt` → `EXPIRED`
- `PICKED_UP` past `deliverBy` → `DISPUTED` (held for admin resolution; **no** event emitted, credits stay reserved)
- `PENDING_COMPLETION` past `confirmBy` → `COMPLETED`

Each terminal transition reuses the same atomic path as the HTTP handlers, so it emits the same terminal events. The auto-dispute is non-terminal, so it accumulates disputed errands awaiting an admin rather than settling credits automatically.

## Development

```sh
npm install
npm run dev        # tsx watch on src/index.ts
npm run build      # tsc -> dist/
npm start          # node dist/index.js
npm run typecheck  # type-check without emitting
npm test           # unit tests (tests/*.test.ts)
```

Unit tests cover creation and compensation recovery, service transition logic, the lifecycle sweep, and the RabbitMQ publisher's confirm/return handling ([tests/](tests/)). They do not require a running MongoDB, RabbitMQ, or Redis; the event publisher can be replaced via `setEventPublisher` in [src/event/publisher.ts](src/event/publisher.ts). For a full run with the backing stores, start the stack with Compose from the repository root.

### Existing MongoDB volumes

Fresh volumes run `config/db.js`, which creates the `orderCreation` collection, its due-work index, and Order's role permission. MongoDB does not rerun that initializer for existing volumes. Before starting the upgraded Order Service against an existing volume, connect as the MongoDB administrator and run the idempotent migration:

```sh
docker compose exec mongodb mongosh --username admin --authenticationDatabase admin --password
```

Enter the administrator password at the `mongosh` prompt, then run:

```javascript
.load("/migrations/order-saga.js")
```

The migration grants Order access to `errands` and `orderCreation` and adds the due-work index. It does not edit existing Errands or Credit balances. Do not use `docker compose down -v` as a substitute: it deletes the project database volume.
