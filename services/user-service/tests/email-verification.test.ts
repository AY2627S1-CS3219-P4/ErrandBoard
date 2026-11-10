import assert from "node:assert/strict";
import { test } from "node:test";
import { User } from "../src/models/User.js";
import { backfillEmailVerification } from "../src/scripts/backfill-email-verification.js";
import { confirmVerificationToken, hashVerificationToken, requestVerificationEmail } from "../src/services/email-verification.service.js";
import { confirmationUrl } from "../src/services/verification-email.sender.js";
import { verificationEmailQueue } from "../src/services/verification-email.queue.js";

test("confirmation links use the configured origin and keep tokens in the fragment", (t) => {
  const prior = process.env.PUBLIC_APP_ORIGIN;
  const priorNodeEnv = process.env.NODE_ENV;
  t.after(() => {
    if (prior === undefined) delete process.env.PUBLIC_APP_ORIGIN;
    else process.env.PUBLIC_APP_ORIGIN = prior;
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorNodeEnv;
  });
  process.env.NODE_ENV = "production";
  process.env.PUBLIC_APP_ORIGIN = "https://errandboard.example";
  const url = new URL(confirmationUrl("a".repeat(64)));
  assert.equal(url.origin, "https://errandboard.example");
  assert.equal(url.pathname, "/confirm-email");
  assert.equal(url.search, "");
  assert.equal(new URLSearchParams(url.hash.slice(1)).get("token"), "a".repeat(64));
  process.env.PUBLIC_APP_ORIGIN = "http://localhost:5173";
  assert.equal(new URL(confirmationUrl("a".repeat(64))).origin, "http://localhost:5173");
  process.env.PUBLIC_APP_ORIGIN = "http://errandboard.example";
  assert.throws(() => confirmationUrl("a".repeat(64)), /trusted web origin/);
});

test("resend stores only a token hash and atomically limits ten attempts per day", async (t) => {
  const user = new User({ email: "e1234567@u.nus.edu", username: "alice", passwordHash: "hash", emailVerified: false });
  let query: Record<string, unknown> | undefined;
  let update: Record<string, unknown> | undefined;
  const claim = t.mock.method(User, "findOneAndUpdate", async (filter: Record<string, unknown>, changes: Record<string, unknown>) => {
    query = filter;
    update = changes;
    return user;
  });
  const enqueue = t.mock.method(verificationEmailQueue, "enqueue", async () => {});
  const before = Date.now();
  assert.equal(await requestVerificationEmail(" E1234567@U.NUS.EDU "), true);
  assert.equal(query?.email, user.email);
  assert.equal(query?.emailVerified, false);
  assert.deepEqual((query?.$or as Array<unknown>).length, 2);
  const quota = (query?.$expr as { $lt: [unknown, number] }).$lt;
  assert.equal(quota[1], 10);
  const stored = (update?.$set as Record<string, unknown>);
  assert.equal(typeof stored.emailVerificationTokenHash, "string");
  assert.ok(stored.emailVerificationRequestedAt instanceof Date);
  assert.ok(stored.emailVerificationExpiresAt instanceof Date);
  assert.ok((stored.emailVerificationExpiresAt as Date).getTime() >= before + 24 * 60 * 60 * 1000);
  const token = enqueue.mock.calls[0]?.arguments[1] as string;
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(stored.emailVerificationTokenHash, hashVerificationToken(token));
  assert.notEqual(stored.emailVerificationTokenHash, token);
  assert.equal(enqueue.mock.calls[0]?.arguments[0], user._id.toString());
  assert.deepEqual(((update?.$push as Record<string, any>).emailVerificationResendAttempts).$slice, -10);

  claim.mock.mockImplementation(async () => null as never);
  assert.equal(await requestVerificationEmail(user.email), false);
  assert.equal(enqueue.mock.callCount(), 1);
});

test("initial registration email does not consume a resend allowance", async (t) => {
  const user = new User({ email: "e1234567@u.nus.edu", username: "alice", passwordHash: "hash", emailVerified: false });
  const claim = t.mock.method(User, "findOneAndUpdate", async () => user);
  t.mock.method(verificationEmailQueue, "enqueue", async () => {});
  assert.equal(await requestVerificationEmail(user.email, "initial"), true);
  assert.equal("$expr" in (claim.mock.calls[0]?.arguments[0] as unknown as Record<string, unknown>), false);
  assert.equal("$push" in (claim.mock.calls[0]?.arguments[1] as unknown as Record<string, unknown>), false);
});

test("failed queue publication releases the interval and resend allowance", async (t) => {
  const user = new User({ email: "e1234567@u.nus.edu", username: "alice", passwordHash: "hash", emailVerified: false });
  t.mock.method(User, "findOneAndUpdate", async () => user);
  t.mock.method(verificationEmailQueue, "enqueue", async () => { throw new Error("queue failed"); });
  const release = t.mock.method(User, "updateOne", async () => ({}));
  await assert.rejects(requestVerificationEmail(user.email), /queue failed/);
  const filter = release.mock.calls[0]?.arguments[0] as unknown as Record<string, unknown>;
  const update = release.mock.calls[0]?.arguments[1] as Record<string, unknown>;
  assert.equal(filter._id?.toString(), user._id.toString());
  assert.match(filter.emailVerificationTokenHash as string, /^[a-f0-9]{64}$/);
  assert.ok("emailVerificationRequestedAt" in (update.$unset as Record<string, unknown>));
  assert.ok("emailVerificationTokenHash" in (update.$unset as Record<string, unknown>));
  assert.ok("emailVerificationResendAttempts" in (update.$pull as Record<string, unknown>));
});

test("confirmation atomically requires an unexpired matching token and consumes it", async (t) => {
  const token = "a".repeat(64);
  let filter: Record<string, unknown> | undefined;
  let update: Record<string, unknown> | undefined;
  let available = true;
  t.mock.method(User, "findOneAndUpdate", async (query: Record<string, unknown>, changes: Record<string, unknown>) => {
    filter = query;
    update = changes;
    if (!available) return null;
    available = false;
    return new User({ emailVerified: true });
  });
  assert.equal(await confirmVerificationToken("bad"), false);
  assert.equal(await confirmVerificationToken(token), true);
  assert.equal(filter?.emailVerified, false);
  assert.equal(filter?.emailVerificationTokenHash, hashVerificationToken(token));
  assert.ok((filter?.emailVerificationExpiresAt as { $gt: Date }).$gt instanceof Date);
  assert.equal((update?.$set as { emailVerified: boolean }).emailVerified, true);
  assert.ok("emailVerificationTokenHash" in (update?.$unset as Record<string, unknown>));
  assert.equal(await confirmVerificationToken(token), false);
});

test("backfill only marks documents missing the verification field", async (t) => {
  const update = t.mock.method(User, "updateMany", async () => ({ modifiedCount: 3 }));
  assert.equal(await backfillEmailVerification(), 3);
  assert.deepEqual(update.mock.calls[0]?.arguments, [
    { emailVerified: { $exists: false } },
    { $set: { emailVerified: true } },
  ]);
});
