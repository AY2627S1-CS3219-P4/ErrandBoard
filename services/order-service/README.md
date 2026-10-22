# Order Service

Owns the errand lifecycle for ErrandBoard. A requester posts an errand against a supplier, a courier accepts and fulfils it, and the service drives the state machine from `OPEN` through to a terminal state. It owns the `errands` collection in the `errandboard` MongoDB database and publishes terminal errand events for the Credit Service consumer to settle against.

The service listens on port `3003`. Inside Compose other services reach it at `http://order-service:3003`; the port is also published to the host for local development.

## Responsibilities

- Create errands, reserving credit from Credit Service before the errand becomes visible.
- Serve the open-errand board (with filtering) and a user's own active errands.
- Apply status transitions requested by the acting requester or courier, enforcing ownership and valid transitions atomically.
- Expire, auto-cancel, and auto-complete errands past their deadlines through a recurring background sweep.
- Publish `errand.completed`, `errand.cancelled`, and `errand.expired` events so credits are transferred or refunded exactly once, retrying delivery until the broker accepts each event.

## Errand lifecycle

Statuses are defined in [src/status/errandState.ts](src/status/errandState.ts). Every transition goes through a single conditional `findOneAndUpdate`, so the status check and the write are one atomic operation.

```
OPEN ──accept──▶ ACCEPTED ──pickup──▶ PICKED_UP ──deliver──▶ PENDING_COMPLETION ──complete──▶ COMPLETED
 │                  │                      │                                                   (terminal)
 │ cancel           │ courier-cancel       │
 ▼                  ▼                      │
CANCELLED ◀─────────┘                      │ (sweep after deliverBy) ──▶ CANCELLED
 (terminal)                                │
 │ (sweep after expiresAt)                 ▼ (sweep after confirmBy) ──▶ COMPLETED
 ▼
EXPIRED (terminal)
```

- `accept` — a courier claims an `OPEN` errand. A requester cannot accept their own errand, an already-assigned errand cannot be reassigned, and an expired errand cannot be accepted. Sets `courierId`.
- `pickup` — the assigned courier marks collection, setting `deliverBy` (2 days out).
- `deliver` — the assigned courier marks delivery before `deliverBy`, setting `confirmBy` (2 days out) and moving to `PENDING_COMPLETION`.
- `complete` — the requester confirms receipt.
- `cancel` / `courier-cancel` — the requester cancels an `OPEN` errand, or the courier cancels one they `ACCEPTED`.

Deadlines are currently all 2 days (`EXPIRY_DEADLINE`, `DELIVERY_DEADLINE`, `CONFIRMATION_DEADLINE` in [src/services/order.services.ts](src/services/order.services.ts)).

## HTTP API

All routes are mounted under `/errands` and require authentication ([src/routes/order.routes.ts](src/routes/order.routes.ts)). `GET /health` is the only unauthenticated endpoint.

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/errands` | List `OPEN`, unexpired errands. Query filters: `supplierId`, `building`, `address` (repeatable, exact match), `dropoff`, `q` (substring), `since` (ISO date). |
| `GET` | `/errands/mine` | The caller's active errands (as requester or courier), newest first. |
| `GET` | `/errands/:id` | A single errand. Visible only to the involved requester/courier, or if it is an open public listing. |
| `POST` | `/errands` | Create an errand. Body: `supplierId`, `dropoff`, `description`, `credit`. |
| `POST` | `/errands/:id/accept` | Courier accepts. |
| `POST` | `/errands/:id/pickup` | Courier marks picked up. |
| `POST` | `/errands/:id/deliver` | Courier marks delivered. |
| `POST` | `/errands/:id/complete` | Requester confirms completion. |
| `POST` | `/errands/:id/cancel` | Requester cancels an open errand. |
| `POST` | `/errands/:id/courier-cancel` | Courier cancels an accepted errand. |

The acting user is always the authenticated subject; the client never supplies a requester or courier id on a transition. Errors are returned as `{ code, error, fields? }`; the mapping from domain error to HTTP status lives in [src/controller/order.controller.ts](src/controller/order.controller.ts) (e.g. `VALIDATION_FAILED` 400, `ERRAND_NOT_FOUND` 404, `SELF_ASSIGN` 403, `DEADLINE_PASSED`/`UPDATE_CONFLICT` 409, `INSUFFICIENT_CREDITS` 400, `SUPPLIER_UNAVAILABLE`/`SERVICE_UPSTREAM_ERROR` 503).

## Authentication & authorization

Requests carry the short-lived `access_token` (HttpOnly cookie used by the frontend, or a `Bearer` token for trusted clients). The token is verified with the shared `JWT_SECRET` ([src/security/token.ts](src/security/token.ts)), then the current role, authorization version, and active/blocked state are checked in Redis before any database read ([src/security/authorization-state.ts](src/security/authorization-state.ts)). Missing or unreachable authorization state fails closed (`503`); revoked or inactive accounts are denied. This mirrors the User and Supplier services.

## Upstream dependencies

Errand creation is synchronous and ordered:

1. **Supplier Service** (`SUPPLIER_SERVICE_URL`) — the supplier is looked up and must be active. Only the `supplierId` comes from the client; the stored supplier name/building/address are copied from the response ([src/clients/supplier.client.ts](src/clients/supplier.client.ts)).
2. **Credit Service** (`CREDIT_SERVICE_URL`) — credit is reserved against the pre-allocated order id before the errand row is written, authenticated with `ORDER_CREDIT_API_KEY` ([src/clients/credit.client.ts](src/clients/credit.client.ts)). The `orderId` is stable so the reservation is idempotent on retry. If reservation fails, no errand is created.

Both calls time out after 3s and surface as `503` to the caller.

## Events

On reaching a terminal state, events are published to the `errand.events` topic exchange on RabbitMQ (`RABBITMQ_URL`). The event type is one of `errand.completed`, `errand.cancelled`, `errand.expired`; the payload carries `eventId` (`<errandId>:<type>`), `requesterId`, `courierId`, `credit`, and `occurredAt`. Because an errand reaches a terminal state exactly once, the errand id is used as the routing key and the event id doubles as the consumer's dedupe key. See [src/event/](src/event/). Credit Service binds its own durable queues to this exchange to refund or transfer credits.

### Reliable delivery (transactional outbox)

Event delivery is tied to the errand row so a broker outage can never silently drop a settlement. The same atomic transition that moves an errand to a terminal state also sets an `eventPending` flag on the document ([src/services/order.services.ts](src/services/order.services.ts)). The service then tries to publish; only on a confirmed publish is `eventPending` cleared — and that clear is written with `timestamps: false` so it does not bump `updatedAt`, which feeds `occurredAt` ([src/event/errand.events.ts](src/event/errand.events.ts)).

If publishing fails, the flag is left set and the event is retried on the next lifecycle sweep tick, which calls `flushPendingEvents()` to re-publish pending errands oldest-first (up to 200 per tick), stopping early when the broker still looks down. A partial index on `eventPending` keeps that scan cheap ([src/models/Errand.ts](src/models/Errand.ts)).

The publisher uses publisher confirms over an `amqp-connection-manager` channel and publishes each message `persistent` and `mandatory` ([src/event/rabbit.publisher.ts](src/event/rabbit.publisher.ts)). A broker `return` (no queue bound) surfaces as `UnroutableError` and a confirm failure as `PublishError`; both leave the event pending for the next retry rather than being treated as delivered.

## Background lifecycle sweep

A BullMQ repeatable job (`errand-lifecycle`, backed by Redis) runs every 20s ([src/queue/queue.ts](src/queue/queue.ts)). Each tick ([src/queue/sweep.ts](src/queue/sweep.ts)) first relays any events still pending from earlier failures (see [Reliable delivery](#reliable-delivery-transactional-outbox)), then finds errands whose deadline has passed and drives them to the correct terminal state — up to 200 per status per tick, the rest wait for the next tick:

- `OPEN` past `expiresAt` → `EXPIRED`
- `PICKED_UP` past `deliverBy` → `CANCELLED`
- `PENDING_COMPLETION` past `confirmBy` → `COMPLETED`

Each transition reuses the same atomic path as the HTTP handlers, so it emits the same terminal events.

## Development

```sh
npm install
npm run dev        # tsx watch on src/index.ts
npm run build      # tsc -> dist/
npm start          # node dist/index.js
npm run typecheck  # type-check without emitting
npm test           # unit tests (tests/*.test.ts)
```

Unit tests cover the service transition logic, the lifecycle sweep, and the RabbitMQ publisher's confirm/return handling ([tests/](tests/)). They do not require a running MongoDB, RabbitMQ, or Redis; the event publisher can be replaced via `setEventPublisher` in [src/event/publisher.ts](src/event/publisher.ts). For a full run with the backing stores, start the stack with Compose from the repository root.
