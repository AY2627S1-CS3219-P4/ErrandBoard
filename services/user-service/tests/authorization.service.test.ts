import assert from "node:assert/strict";
import { test } from "node:test";
import { Session } from "../src/models/Session.js";
import { User } from "../src/models/User.js";
import { authorizationStore, checkAuthorization, type AuthorizationState } from "../src/security/authorization-state.js";
import { updateManagedAccount } from "../src/services/authorization.service.js";

const id = "507f1f77bcf86cd799439011";

for (const change of [{ accountType: "USER" }, { accountType: "ADMIN" }, { isActive: false }, { isActive: true }] as const) {
  test(`changing ${JSON.stringify(change)} revokes existing access and sessions before success`, async (t) => {
    const initialActive = "isActive" in change ? !change.isActive : true;
    const initialRole = "accountType" in change && change.accountType === "ADMIN" ? "USER" : "ADMIN";
    const user = new User({ _id: id, email: "e1234567@u.nus.edu", username: "admin_user",
      passwordHash: "stored-hash", accountType: initialRole, isActive: initialActive, authzVersion: 2 });
    let live: AuthorizationState = { version: 2, role: initialRole, active: initialActive, blocked: false };
    const stages: string[] = [];
    t.mock.method(User, "findOne", async () => user);
    t.mock.method(authorizationStore, "read", async () => live);
    t.mock.method(authorizationStore, "block", async () => {
      stages.push("block");
      live = { ...live, blocked: true };
      return { version: 2, role: initialRole, active: initialActive, blocked: false };
    });
    t.mock.method(Session, "updateMany", async (filter: Record<string, unknown>) => {
      stages.push("revoke sessions");
      assert.equal(filter.userId, user._id);
      assert.equal(await checkAuthorization(id, initialRole, 2), "revoked");
      return {};
    });
    t.mock.method(User, "findOneAndUpdate", async (_filter: unknown, update: { $set: unknown; $inc: { authzVersion: number } }) => {
      stages.push("update MongoDB");
      assert.deepEqual(update.$set, change);
      assert.equal(update.$inc.authzVersion, 1);
      return new User({ ...user.toObject(), ...change, authzVersion: 3 });
    });
    process.env.CREDIT_SERVICE_URL = "http://credit-service:3004";
    process.env.CREDIT_INTERNAL_API_KEY = "test-credit-key";
    t.after(() => {
      delete process.env.CREDIT_SERVICE_URL;
      delete process.env.CREDIT_INTERNAL_API_KEY;
    });
    const creditCall = t.mock.method(globalThis, "fetch", async (url: URL | string | Request, options?: RequestInit) => {
      stages.push("sync credit");
      assert.equal(url.toString(), `http://credit-service:3004/credit/accounts/${id}`);
      assert.deepEqual(JSON.parse(options?.body as string), { isActive: "isActive" in change ? change.isActive : undefined });
      return new Response(null, { status: 204 });
    });
    t.mock.method(authorizationStore, "publish", async (_userId: string, _previous: AuthorizationState, updated: InstanceType<typeof User>) => {
      stages.push("publish Redis");
      live = { version: updated.authzVersion, role: updated.accountType, active: updated.isActive, blocked: false };
    });

    const updated = await updateManagedAccount(id, change);
    assert.ok(updated);
    assert.deepEqual(stages, "isActive" in change
      ? ["block", "revoke sessions", "update MongoDB", "sync credit", "publish Redis"]
      : ["block", "revoke sessions", "update MongoDB", "publish Redis"]);
    assert.equal(creditCall.mock.callCount(), "isActive" in change ? 1 : 0);
    assert.equal(updated.isActive, "isActive" in change ? change.isActive : true);
    assert.equal(await checkAuthorization(id, initialRole, 2), "isActive" in change && !change.isActive ? "inactive" : "revoked");
    assert.equal(updated.authzVersion, 3);
  });
}

test("a Redis publishing failure leaves the account blocked and does not report success", async (t) => {
  const user = new User({ _id: id, email: "e1234567@u.nus.edu", username: "admin_user",
    passwordHash: "stored-hash", accountType: "ADMIN", authzVersion: 0 });
  t.mock.method(User, "findOne", async () => user);
  t.mock.method(authorizationStore, "block", async () => ({ version: 0, role: "ADMIN", active: true, blocked: false }));
  t.mock.method(Session, "updateMany", async () => ({}));
  t.mock.method(User, "findOneAndUpdate", async () => new User({ ...user.toObject(), accountType: "USER", authzVersion: 1 }));
  t.mock.method(authorizationStore, "publish", async () => { throw new Error("Redis unavailable"); });
  t.mock.method(authorizationStore, "read", async () => ({ version: 0, role: "ADMIN", active: true, blocked: true }));

  await assert.rejects(updateManagedAccount(id, { accountType: "USER" }), /Redis unavailable/);
  assert.equal(await checkAuthorization(id, "ADMIN", 0), "revoked");
});

test("credit sync failure keeps an account-status change blocked and does not publish success", async (t) => {
  process.env.CREDIT_SERVICE_URL = "http://credit-service:3004";
  process.env.CREDIT_INTERNAL_API_KEY = "test-credit-key";
  t.after(() => {
    delete process.env.CREDIT_SERVICE_URL;
    delete process.env.CREDIT_INTERNAL_API_KEY;
  });
  const user = new User({ _id: id, email: "e1234567@u.nus.edu", username: "admin_user",
    passwordHash: "stored-hash", accountType: "ADMIN", isActive: true, authzVersion: 2 });
  let blocked = false;
  t.mock.method(User, "findOne", async () => user);
  t.mock.method(authorizationStore, "block", async () => {
    blocked = true;
    return { version: 2, role: "ADMIN", active: true, blocked: false };
  });
  t.mock.method(Session, "updateMany", async () => ({}));
  t.mock.method(User, "findOneAndUpdate", async () => new User({ ...user.toObject(), isActive: false, authzVersion: 3 }));
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 503 }));
  const publish = t.mock.method(authorizationStore, "publish", async () => {});

  await assert.rejects(updateManagedAccount(id, { isActive: false }),
    (error: unknown) => error instanceof Error && "status" in error && error.status === 503);
  assert.equal(blocked, true);
  assert.equal(publish.mock.callCount(), 0);
});

test("missing or unreachable live state denies a signed token", async (t) => {
  t.mock.method(authorizationStore, "read", async () => null);
  assert.equal(await checkAuthorization(id, "ADMIN", 0), "unavailable");
  t.mock.method(authorizationStore, "read", async () => { throw new Error("connection lost"); });
  assert.equal(await checkAuthorization(id, "ADMIN", 0), "unavailable");
});

test("an unchanged admin PATCH cannot report success while authorization is blocked", async (t) => {
  const user = new User({ _id: id, email: "e1234567@u.nus.edu", username: "admin_user",
    passwordHash: "stored-hash", accountType: "ADMIN", authzVersion: 1 });
  t.mock.method(User, "findOne", async () => user);
  t.mock.method(authorizationStore, "read", async () => ({ version: 1, role: "ADMIN", active: true, blocked: true }));
  const write = t.mock.method(User, "findOneAndUpdate", async () => user);

  await assert.rejects(updateManagedAccount(id, { accountType: "ADMIN" }), /Authorization state is unavailable/);
  assert.equal(write.mock.callCount(), 0);
});
