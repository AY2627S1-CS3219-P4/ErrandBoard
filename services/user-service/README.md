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

The User Service keeps ErrandBoard passwords and sessions. New accounts start with `emailVerified: false`; login and session refresh reject explicitly unverified accounts. Legacy accounts without the field remain usable until the additive backfill. Production registration and resend require `REGISTRATION_ENABLED=true`; keep it `false` on AWS during this private pilot.

The separate Cognito pool `ap-southeast-1_ODByyE8Yt` in `ap-southeast-1` sends a hosted verification link from Cognito's default sender. The confidential User Service app client is `19nlq0t22dumrkh7a40po9mq52`. Set `EMAIL_VERIFICATION_PROVIDER=cognito`, `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`, `COGNITO_CONFIRMATION_QUEUE_URL`, and `COGNITO_CONFIRMATION_WORKER_ENABLED=true`. Inject `COGNITO_APP_CLIENT_SECRET` from the protected `pre-prod_env` Secrets Manager JSON key; never commit it. The ECS task role `ErrandBoardUserServiceEmailTaskRole` has only the [pilot Cognito/SQS permissions](../../infra/iam/user-service-cognito-task-policy.json).

Registration creates the MongoDB account, then signs up the normalized email in Cognito with an independent random password. The User Service stores Cognito's subject on the pending account. After the user clicks the link, the post-confirmation Lambda sends pool ID and subject to `ErrandBoardCognitoConfirmation` SQS. The worker checks the Cognito account is confirmed and its email is verified, atomically marks the matching MongoDB account verified, and deletes the temporary Cognito user. A duplicate queue event succeeds after both updates. Failed events retry and then move to `ErrandBoardCognitoConfirmationDLQ`; a confirmed account can also reconcile on login. Resend returns the same response for unknown, verified, and rate-limited addresses, with one attempt per minute and ten per rolling 24 hours.

On 11 November 2026, a link reached `e1397822@u.nus.edu`. A private ECS task using the deployed User Service image proved login was blocked before confirmation, then verified that the Lambda, queue worker, MongoDB update, Cognito deletion, and login succeeded after the link click. The disposable MongoDB and Redis test records were deleted; the task exited 0. Both Cognito queues were empty afterward. This did not exercise the public HTTP registration route, which remains closed. The separate invitation test pool `ap-southeast-1_LaskufyMZ` remains intact. Cognito's default sender has a 50-email-per-day account limit.

### Rollback

The pre-pilot task definition is `user-service:21`, desired count 1. To revert the service, run `aws ecs update-service --region ap-southeast-1 --cluster ErrandBoard --service user-service --task-definition user-service:21 --desired-count 1`, then `aws ecs wait services-stable --region ap-southeast-1 --cluster ErrandBoard --services user-service`. Keep `REGISTRATION_ENABLED=false` throughout. Revision 21 predates the email verification gate, so resolve any pending accounts before relying on it. A local pre-Cognito patch and untracked-file snapshot is in the ChatGPT project at `rollback-2026-11-11-pre-cognito`. The old SES identity, queues, and task policy were removed after the Cognito end-to-end test because the NUS address sender failed DMARC; SES is no longer an operational fallback.

The `npm run email:backfill` migration sets `emailVerified: true` only where the field is absent. It has **not** been run. Do not run reset-and-seed. Keep public registration off until a separate rollout establishes the desired browser-trusted site URL and operational monitoring.
