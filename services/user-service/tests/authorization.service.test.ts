import assert from "node:assert/strict";
import { test } from "node:test";
import { Session } from "../src/models/Session.js";
import { User } from "../src/models/User.js";
import { authorizationStore, checkAuthorization, type AuthorizationState } from "../src/security/authorization-state.js";
import { updateManagedAccount } from "../src/services/authorization.service.js";

const id = "507f1f77bcf86cd799439011";

for (const change of [{ accountType: "USER" }, { isActive: false }] as const) {
  test(`changing ${Object.keys(change)[0]} revokes existing access and sessions before success`, async (t) => {
    const user = new User({ _id: id, email: "e1234567@u.nus.edu", username: "admin_user",
      passwordHash: "stored-hash", accountType: "ADMIN", isActive: true, authzVersion: 2 });
    let live: AuthorizationState = { version: 2, role: "ADMIN", active: true, blocked: false };
    const stages: string[] = [];
    t.mock.method(User, "findOne", async () => user);
    t.mock.method(authorizationStore, "read", async () => live);
    t.mock.method(authorizationStore, "block", async () => {
      stages.push("block");
      live = { ...live, blocked: true };
      return { version: 2, role: "ADMIN", active: true, blocked: false };
    });
    t.mock.method(Session, "updateMany", async (filter: Record<string, unknown>) => {
      stages.push("revoke sessions");
      assert.equal(filter.userId, user._id);
      assert.equal(await checkAuthorization(id, "ADMIN", 2), "revoked");
      return {};
    });
    t.mock.method(User, "findOneAndUpdate", async (_filter: unknown, update: { $set: unknown; $inc: { authzVersion: number } }) => {
      stages.push("update MongoDB");
      assert.deepEqual(update.$set, change);
      assert.equal(update.$inc.authzVersion, 1);
      return new User({ ...user.toObject(), ...change, authzVersion: 3 });
    });
    t.mock.method(authorizationStore, "publish", async (_userId: string, _previous: AuthorizationState, updated: InstanceType<typeof User>) => {
      stages.push("publish Redis");
      live = { version: updated.authzVersion, role: updated.accountType, active: updated.isActive, blocked: false };
    });

    const updated = await updateManagedAccount(id, change);
    assert.ok(updated);
    assert.deepEqual(stages, ["block", "revoke sessions", "update MongoDB", "publish Redis"]);
    assert.equal(await checkAuthorization(id, "ADMIN", 2), "isActive" in change ? "inactive" : "revoked");
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
