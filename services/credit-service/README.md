# Credit Service setup

This service owns the `UserCredits` and `transactionLog` collections. `UserCredits.userId` stores the MongoDB ObjectId of a User, but the credit service has no access to the `users` collection. A unique MongoDB index enforces at most one credit account per user.

Set `MONGO_CREDIT_SERVICE_PASSWORD`, a high-entropy `CREDIT_INTERNAL_API_KEY`, a separate high-entropy `ORDER_CREDIT_API_KEY`, and `MONGO_REPLICA_SET_KEY` in local environment configuration before starting Compose. Keep the API keys out of frontend code. The service is reachable by other Compose services at `http://credit-service:3004`; it has no published host port. Local Docker-network HTTP is not a production transport-security solution; use TLS and workload identity for deployed services.

MongoDB now starts as a single-node replica set named `rs0`, then the `mongodb-rs-init` job elects its primary. This is needed for atomic Credit transactions; it is not sharding. **Do not run `docker compose down -v` just to apply this change:** that command destroys all local database volumes. An existing MongoDB volume can be restarted with the new topology, provided its database credentials match the existing data. Add the two new keys to your local environment before starting Compose. For host-side `mongosh`, use `directConnection=true` because the replica set advertises the Docker-only hostname `mongodb`.

On a **new MongoDB volume**, `config/db.js` creates the credit role, account, collections, and unique index. On an **existing volume**, initialization scripts do not run again. Apply the migration as a MongoDB administrator before starting the credit service:

```sh
docker compose up -d mongodb
docker compose exec mongodb mongosh --username admin --authenticationDatabase admin --password
```

At the `mongosh` prompt, enter the MongoDB root password, then run:

```javascript
.load("/migrations/credit-service.js")
```

The migration is safe to rerun. It updates the credit role's collection permissions, creates the credit account if missing, and creates the indexes. If an older non-unique `userId` index exists, it checks for duplicates before replacing that index with the unique one. It also checks for duplicate `(orderId, transactionType)` phases and legacy transaction-log formats before creating that unique index; either condition requires manual reconciliation. It does not reset an existing credit-service account password. The running service does not create indexes or need index-management privileges.

`PUT /credit/accounts/:userId` provisions an account once and synchronizes its `isActive` status. It requires `Authorization: Bearer <CREDIT_INTERNAL_API_KEY>`, validates the ObjectId and optional boolean `isActive` body field, and returns 204 whether the account was newly inserted or already present. Repeating it does **not** reset an existing balance. User registration, user seeding, and superadmin activation/deactivation call this endpoint; role changes do not.

`GET /credit/me/balance` returns `{ "available": 100, "reserve": 0 }` for the authenticated user's own Credit account. It accepts the short-lived `access_token` HttpOnly cookie used by the frontend (or a Bearer access token for a trusted client). Credit verifies the JWT with the same `JWT_SECRET` as User Service, then checks the current role, authorization version, and active/blocked state in Redis before reading MongoDB. It uses only the verified JWT subject as `userId`; no caller-supplied account ID is accepted. Missing/invalid/expired/revoked tokens and inactive accounts are denied; Redis outages fail closed with 503. A missing Credit account returns 404. The frontend/proxy is not wired to this endpoint in this branch.

`POST /credit/reservations` is the internal Order Service API. It requires `Authorization: Bearer <ORDER_CREDIT_API_KEY>` and JSON `{ "orderId": "<Mongo ObjectId>", "requesterId": "<Mongo ObjectId>", "amount": 20 }`. The `orderId` must be stable across retries. The response is `200 { "applied": true }` on first success and `200 { "applied": false }` for the same request repeated. Invalid inputs get 400; an inactive/missing account, insufficient available balance, or an incompatible duplicate order phase gets 409. The Order Service must reserve before reporting order creation as successful, and handle an Order database failure after reservation with compensation/reconciliation. Its create-order handler is not yet implemented in this branch.

The RabbitMQ consumer starts with Credit Service and declares a durable `credit.errand.events` queue bound to `errand.events` for `errand.cancelled`, `errand.expired`, and `errand.completed`. It maps cancellation and expiry to `refundCredits({ orderId, requesterId, amount })`, and completion to `transferCredits({ orderId, requesterId, courierId, amount })`. It acknowledges a delivery only after the Credit operation succeeds or returns `applied: false`. Transient failures pass through a durable retry queue with a 10-second delay, up to five retries. Invalid messages, permanent conflicts, and exhausted retries go to `credit.errand.events.dead` for inspection and reconciliation. The Order service currently has no expiry job, so it does not yet publish `errand.expired` in normal use.

Authenticated browsers can subscribe to `GET /credit/me/events` for Server-Sent Events. Credit sends a `credit-balance-updated` notification after successful reservations, refunds, and transfers; the event contains no balance data, so the browser fetches its own balance through `GET /credit/me/balance`. A new stream receives an initial notification so reconnecting clients refresh after downtime.

Credit interprets `ORDER_START` from the synchronous reservation call and `ORDER_END` from the first successful refund or transfer. A unique `(orderId, transactionType)` index permits only one of each. The `ORDER_END` transfer has **one** log record containing both user IDs and its amount; the requester debit, courier credit, and log insert all commit or roll back together in one MongoDB transaction. New reservations require an active requester, while an already-reserved order may refund or transfer after an account is deactivated so credits are not trapped. This is an explicit settlement policy to review with the team.

The User Service seed retries credit provisioning for all users in the seed CSV (including users inserted on previous runs). For accounts that predate this integration and are **not** in the CSV, run the one-time backfill after the credit service is healthy:

```sh
docker compose run --rm --no-deps user-service npm run credits:backfill
```

Start MongoDB and Credit Service before running that command. The backfill is idempotent and does not reset balances. It is not part of routine service startup. Credit and User updates are separate service writes, so a credit-service failure during registration can leave a User awaiting backfill; an activation/deactivation failure leaves authorization blocked until the services are reconciled.

Run `npm test` in this directory for provisioning and Credit operation unit tests. Full MongoDB integration testing still requires a running replica set.
