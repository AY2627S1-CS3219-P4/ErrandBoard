# User Service authorization state (Phase 2)

MongoDB is the durable record for account role, active status, authorization version, and refresh sessions. Redis holds the current role, active status, version, and a temporary block for each user. Every protected User or Supplier Service request compares the signed access token with Redis. Missing or unreachable Redis state denies authorization; it never grants access.

The local `compose.yaml` starts Redis on the Compose network, and `REDIS_URL` points both services at that container. In the current AWS deployment, Redis runs as a private ECS service on the database EC2 host; app tasks use its private DNS name. Keep Redis inaccessible from the public internet.

On a role change, deactivation/reactivation, or password change, User Service blocks the user's Redis state, revokes all refresh sessions, updates MongoDB and increments `authzVersion`, then publishes the new state. A successful response means the new state is visible to token verifiers. Access tokens issued before the version change are rejected immediately on subsequent requests. Requests already in progress cannot be recalled.

At startup, User Service fills only missing Redis records from MongoDB. It does not overwrite a blocked record left by an interrupted change. If Redis is restarted empty while services are running, protected calls fail closed until User Service is restarted or state is rebuilt.

For recovery from a stuck block, stop User Service writes first, then run:

```bash
docker compose stop user-service
docker compose run --rm -e AUTHZ_RECOVERY_CONFIRM=I_STOPPED_USER_SERVICE_WRITES user-service npm run authz:rebuild
docker compose up -d user-service
```

The rebuild removes authorization keys for deleted users and replaces the remaining keys from MongoDB. Keep User Service writes stopped throughout recovery so a concurrent account change cannot be overwritten. This recovery procedure does not require opening Redis to the host.

## Credit account synchronization

Registration provisions a credit account through the private Credit Service API using the newly created `users._id`. A normal response is HTTP 201. If Credit is unavailable or its response is lost, registration returns HTTP 202 with `CREDIT_SETUP_PENDING`; the User exists but must confirm their email before logging in. The pending flag, retry time, attempts, and short worker lease are stored on the User document. A worker retries after 5 seconds, doubles the interval up to a 5-minute cap, and resumes after restarts. It can safely retry a request that Credit already applied: Credit's unique `userId` index and idempotent upsert do not reset `available` or `reserve`. Credit-dependent actions require a provisioned Credit account.

The CSV seed uses the persisted User IDs and synchronizes every account in the CSV, including those inserted by an earlier seed run. It sends the persisted `isActive` value, not a value inferred from the CSV. Repeated calls never reset balances. Operators can inspect `users` where `creditSetupPending: true` and check `creditSetupAttempts`/`creditSetupNextRetryAt` if setup is delayed. A persistently rising attempt count indicates a dependency or credential problem; no user should register a second account to recover it.

Users created before this integration but absent from the seed CSV need a one-time backfill after MongoDB and Credit Service are running:

```bash
docker compose run --rm --no-deps user-service npm run credits:backfill
```

This command scans existing Users in batches of ten, clears the pending flag after confirmed provisioning, and does not run on each normal startup. It also repairs old Users that predate the pending flag. If Credit Service fails while an admin changes `isActive`, User Service leaves authorization blocked instead of reporting success. After Credit Service is restored, stop User Service writes, run the credit backfill, then run the authorization-state rebuild shown above before resuming the service. Role promotion and demotion do not change credit accounts.

## Email confirmation

New registrations explicitly store `emailVerified: false`. A 24-hour confirmation token is stored only as a SHA-256 hash on the User document. Confirmation updates the matching unverified document atomically and removes the token, so a link can be used only once. Resending is limited to one attempt per account per minute and returns the same response for unknown, verified, and rate-limited addresses. An email delivery failure leaves the account unverified and allows another resend attempt. Existing sessions and logins are rejected when `emailVerified` is explicitly false. Legacy accounts with the field absent remain usable until backfilled.

Set `AWS_REGION=ap-southeast-1`, `SES_FROM_EMAIL=no-reply@<chosen-domain>`, and `PUBLIC_APP_ORIGIN=https://<chosen-domain>` in the deployed user-service task definition. The app sends through SES using the ECS task role; grant that role `ses:SendEmail` on the verified sending identity. The sender and origin must be configured before registrations are enabled. For local Compose, the origin defaults to `http://localhost:5173`; sending still requires a configured sender and AWS credentials. No token or email body is logged by the service.

After the verification-capable service is deployed, run the additive migration once using the user-service image and its existing MongoDB connection settings:

```bash
npm run email:backfill
```

The script sets `emailVerified: true` only where the field is absent. It can be rerun without changing verified or unverified accounts and does not reset or reseed data. The seed script marks every CSV account verified on insert and match without overwriting its other fields. Do not use the reset-and-seed workflow for this migration. During a rolling deployment, avoid routing new registrations to a new task while login requests still reach an old task, because old tasks do not enforce the verification gate. Run the backfill after all old tasks have drained so it covers any account they created.

AWS setup remains a separate step: choose and register a domain, point it to the load balancer with trusted HTTPS, verify the sending domain in SES and publish its DKIM records, obtain SES production sending access, then configure the task role and environment variables above. Test delivery to an external address before enabling public registration.
