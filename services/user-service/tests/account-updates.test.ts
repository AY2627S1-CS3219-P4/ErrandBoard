import assert from "node:assert/strict";
import { before, test, type TestContext } from "node:test";
import { User } from "../src/models/User.js";
import { Session } from "../src/models/Session.js";
import { AccountUpdateError, updateOwnAccount } from "../src/services/auth.service.js";
import { hashPassword, verifyPassword } from "../src/security/password.js";
import { hashSessionToken } from "../src/security/session-token.js";
import { authorizationStore } from "../src/security/authorization-state.js";

const currentPassword = "Current test password!";
const newPassword = "qf7$Lx2@vB9!Rk3#nP5^wM8";
let owner: InstanceType<typeof User>;
before(async () => {
  owner = new User({ email: "e1234567@u.nus.edu", username: "owner",
    passwordHash: await hashPassword(currentPassword) });
});

function session(t: TestContext) {
  t.mock.method(authorizationStore, "read", async () => ({ version: 0, role: "USER", active: true, blocked: false }));
  t.mock.method(Session, "findOne", async (query: Record<string, unknown>) => {
    assert.equal(query.tokenHash, hashSessionToken("test-token"));
    assert.deepEqual(query.revokedAt, { $exists: false });
    assert.ok((query.expiresAt as { $gt: Date }).$gt instanceof Date);
    return { userId: owner._id };
  });
  t.mock.method(User, "findById", (id: unknown) => {
    assert.equal(id, owner._id);
    return { select: async () => owner };
  });
}

test("username update needs only an active session and targets only its owner", async (t) => {
  session(t);
  t.mock.method(User, "findOneAndUpdate", async (query: unknown, update: unknown, options: unknown) => {
    assert.deepEqual(query, { _id: owner._id, passwordHash: owner.passwordHash, authzVersion: { $in: [null, 0] } });
    assert.deepEqual(update, { $set: { username: "renamed" } });
    assert.deepEqual(options, { returnDocument: "after", runValidators: true });
    return new User({ ...owner.toObject(), username: "renamed" });
  });
  const result = await updateOwnAccount("test-token", undefined, { username: "renamed" });
  assert.equal(result.username, "renamed");
  assert.deepEqual(Object.keys(result).sort(), ["accountType", "email", "id", "username"]);
});

test("password updates store a bcrypt hash rather than plaintext", async (t) => {
  session(t);
  t.mock.method(authorizationStore, "block", async () => ({ version: 0, role: "USER", active: true, blocked: false }));
  const publish = t.mock.method(authorizationStore, "publish", async () => {});
  const revoke = t.mock.method(Session, "updateMany", async () => ({}));
  t.mock.method(User, "findOneAndUpdate", async (_query: unknown, update: {
    $set: { passwordHash: string }; $inc: { authzVersion: number };
  }) => {
    assert.notEqual(update.$set.passwordHash, newPassword);
    assert.equal(await verifyPassword(newPassword, update.$set.passwordHash), true);
    assert.equal(update.$inc.authzVersion, 1);
    return new User({ ...owner.toObject(), authzVersion: 1 });
  });
  await updateOwnAccount("test-token", currentPassword, { newPassword });
  assert.equal(revoke.mock.callCount(), 1);
  assert.equal(publish.mock.callCount(), 1);
});

test("password updates reject a wrong current password without writing", async (t) => {
  session(t);
  const write = t.mock.method(User, "findOneAndUpdate", async () => null);
  await assert.rejects(
    updateOwnAccount("test-token", "wrong-current-password", { newPassword }),
    (error: unknown) => error instanceof AccountUpdateError && error.status === 403,
  );
  assert.equal(write.mock.callCount(), 0);
});

test("missing sessions and deleted users cannot update an account", async (t) => {
  t.mock.method(Session, "findOne", async () => null);
  await assert.rejects(updateOwnAccount("test-token", currentPassword, { username: "renamed" }), AccountUpdateError);
  t.mock.method(Session, "findOne", async () => ({ userId: owner._id }));
  t.mock.method(User, "findById", () => ({ select: async () => null }));
  await assert.rejects(updateOwnAccount("test-token", currentPassword, { username: "renamed" }), AccountUpdateError);
});

test("a concurrent password replacement causes a conflict instead of overwriting it", async (t) => {
  session(t);
  t.mock.method(User, "findOneAndUpdate", async () => null);
  await assert.rejects(updateOwnAccount("test-token", currentPassword, { username: "renamed" }),
    (error: unknown) => error instanceof AccountUpdateError && error.status === 409);
});

test("the existing password cannot be reused as the new password", async (t) => {
  session(t);
  const write = t.mock.method(User, "findOneAndUpdate", async () => null);
  await assert.rejects(updateOwnAccount("test-token", currentPassword, { newPassword: currentPassword }),
    (error: unknown) => error instanceof AccountUpdateError && error.status === 400);
  assert.equal(write.mock.callCount(), 0);
});
