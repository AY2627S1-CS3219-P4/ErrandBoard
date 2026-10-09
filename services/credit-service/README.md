# Credit Service setup

This service owns the `UserCredits` and `transactionLog` collections. `UserCredits.userId` stores the MongoDB ObjectId of a User, but the credit service has no access to the `users` collection. A unique MongoDB index enforces at most one credit account per user.

Set `MONGO_CREDIT_SERVICE_PASSWORD` and a high-entropy `CREDIT_INTERNAL_API_KEY` in your local environment configuration before starting the Compose service. Keep the API key out of frontend code. The service is reachable by other Compose services at `http://credit-service:3004`; it has no published host port.

On a **new MongoDB volume**, `config/db.js` creates the credit role, account, collections, and unique index. On an **existing volume**, initialization scripts do not run again. Apply the migration as a MongoDB administrator before starting the credit service:

```sh
docker compose up -d mongodb
docker compose exec mongodb mongosh --username admin --authenticationDatabase admin --password
```

At the `mongosh` prompt, enter the MongoDB root password, then run:

```javascript
.load("/migrations/credit-service.js")
```

The migration is safe to rerun. It updates the credit role's collection permissions, creates the credit account if missing, and creates the indexes. If an older non-unique `userId` index exists, it checks for duplicates before replacing that index with the unique one. If duplicates exist, the migration stops; inspect and resolve them before retrying. It does not reset an existing credit-service account password. The running service does not create indexes or need index-management privileges.

`PUT /credit/accounts/:userId` provisions an account once and synchronizes its `isActive` status. It requires `Authorization: Bearer <CREDIT_INTERNAL_API_KEY>`, validates the ObjectId and optional boolean `isActive` body field, and returns 204 whether the account was newly inserted or already present. Repeating it does **not** reset an existing balance. User registration, user seeding, and superadmin activation/deactivation call this endpoint; role changes do not.

The User Service seed retries credit provisioning for all users in the seed CSV (including users inserted on previous runs). For accounts that predate this integration and are **not** in the CSV, run the one-time backfill after the credit service is healthy:

```sh
docker compose run --rm --no-deps user-service npm run credits:backfill
```

Start MongoDB and Credit Service before running that command. The backfill is idempotent and does not reset balances. It is not part of routine service startup. Credit and User updates are separate service writes, so a credit-service failure during registration can leave a User awaiting backfill; an activation/deactivation failure leaves authorization blocked until the services are reconciled.

Run `npm test` in this directory for the current provisioning tests.
