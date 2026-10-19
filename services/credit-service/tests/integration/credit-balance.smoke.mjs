// Run inside the running Credit Service container so this checks its real HTTP,
// Redis authorization, and MongoDB path without copying credentials to the host:
// docker exec -i -e TEST_USER_ID=<users._id> errandboard-credit-service-1 \
//   node --input-type=module < services/credit-service/tests/integration/credit-balance.smoke.mjs
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { createClient } from "redis";
import { Types } from "mongoose";
import { connectDb, disconnectDb } from "./dist/db.js";
import { UserCredit } from "./dist/models/UserCredit.js";

const userId = process.env.TEST_USER_ID;
assert.match(userId ?? "", /^[0-9a-fA-F]{24}$/, "Set TEST_USER_ID to a users._id");
assert.ok(process.env.JWT_SECRET, "Credit Service must have JWT_SECRET");

const redis = createClient({ url: process.env.REDIS_URL });
redis.on("error", () => {});

try {
  await connectDb();
  await redis.connect();

  const account = await UserCredit.findOne({ userId: new Types.ObjectId(userId) })
    .select("available reserve -_id")
    .lean();
  assert.ok(account, "A UserCredit document must exist for TEST_USER_ID");

  const rawState = await redis.get(`authz:user:${userId}`);
  assert.ok(rawState, "User must have Redis authorization state (log in first)");
  const state = JSON.parse(rawState);
  assert.equal(state.active, true, "Test user must be active");
  assert.equal(state.blocked, false, "Test user must not be blocked");

  const token = await new SignJWT({
    sub: userId,
    role: state.role,
    authzVersion: state.version,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime("1m")
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));

  const baseUrl = `http://127.0.0.1:${process.env.PORT ?? 3004}/credit/me/balance`;
  const unauthenticated = await fetch(baseUrl);
  assert.equal(unauthenticated.status, 401, "Missing cookie must be rejected");

  const authenticated = await fetch(`${baseUrl}?userId=000000000000000000000000`, {
    headers: { Cookie: `access_token=${token}` },
  });
  const responseBody = await authenticated.json();
  assert.equal(authenticated.status, 200, JSON.stringify(responseBody));
  assert.deepEqual(responseBody, {
    available: account.available,
    reserve: account.reserve,
  }, "GET must return the authenticated user's stored balances, ignoring query userId");

  console.log("PASS: unauthenticated GET is denied; authenticated GET matches UserCredit");
} finally {
  if (redis.isOpen) await redis.quit();
  await disconnectDb();
}
