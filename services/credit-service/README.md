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

`PUT /credit/accounts/:userId` provisions an account once. It requires `Authorization: Bearer <CREDIT_INTERNAL_API_KEY>`, validates the ObjectId, and returns 204 whether the account was newly inserted or already present. Repeating it does **not** reset an existing balance. Registration and seeding do not call it yet; those integrations belong to follow-up work.

Run `npm test` in this directory for the current provisioning tests.
