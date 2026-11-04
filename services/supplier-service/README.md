# Supplier Service authorization (Phase 2)

Protected supplier requests verify the access JWT, then read the user's current authorization version, role, and active status from Redis. A stale token is rejected even before its 15-minute expiry. Redis misses and connection errors return `503 AUTHORIZATION_UNAVAILABLE` and do not grant access. Public supplier listings remain accessible without a token; if a valid token is supplied for admin-only listing behavior, its live authorization is checked too.

The local Compose stack provides `REDIS_URL`. In the current AWS deployment, both User and Supplier services use the same private Redis ECS service on the database EC2 host. Supplier Service only reads authorization state and never changes roles or versions.
