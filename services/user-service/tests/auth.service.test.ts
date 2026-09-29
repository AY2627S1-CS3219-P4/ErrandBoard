import assert from "node:assert/strict";
import { before, test } from "node:test";
import { Session } from "../src/models/Session.js";
import { User } from "../src/models/User.js";
import { hashPassword, verifyPassword } from "../src/security/password.js";
import { hashSessionToken } from "../src/security/session-token.js";
import {
  authenticateUser,
  createUserSession,
  registerUser,
  revokeUserSession,
} from "../src/services/auth.service.js";

const input = {
  email: "alice@example.com",
  username: "alice",
  password: "A test password!",
};
let storedUser: InstanceType<typeof User>;

before(async () => {
  storedUser = new User({
    email: input.email,
    username: input.username,
    passwordHash: await hashPassword(input.password),
  });
});

test("registration sends only a hash to persistence and returns safe account fields", async (t) => {
  let persisted: Record<string, unknown> | undefined;
  t.mock.method(User, "create", async (document: Record<string, unknown>) => {
    persisted = document;
    // Simulate model validation/defaults, not actual database persistence.
    const user = new User(document);
    await user.validate();
    return user;
  });

  // Simulate a caller attempting to inject a privileged account type.
  const result = await registerUser({ ...input, accountType: "ADMIN" } as typeof input);
  assert.ok(persisted);
  assert.deepEqual(Object.keys(persisted).sort(), ["email", "passwordHash", "username"]);
  assert.equal(typeof persisted.passwordHash, "string");
  assert.notEqual(persisted.passwordHash, input.password);
  assert.equal(await verifyPassword(input.password, persisted.passwordHash as string), true);
  assert.deepEqual(Object.keys(result).sort(), ["accountType", "email", "id", "username"]);
  assert.equal(result.accountType, "USER");
  assert.equal(result.email, input.email);
  assert.equal(result.username, input.username);
  assert.match(result.id, /^[a-f0-9]{24}$/);
});

test("login retrieves the password hash and accepts valid credentials", async (t) => {
  t.mock.method(User, "findOne", (filter: unknown) => {
    assert.deepEqual(filter, { email: input.email });
    return {
      select: async (projection: string) => {
        assert.equal(projection, "+passwordHash");
        return storedUser;
      },
    };
  });
  assert.equal(await authenticateUser(input.email, input.password), storedUser);
});

test("unknown account and wrong password both produce authentication failure", async (t) => {
  let found: typeof storedUser | null = null;
  t.mock.method(User, "findOne", () => ({ select: async () => found }));
  assert.equal(await authenticateUser(input.email, input.password), null);
  found = storedUser;
  assert.equal(await authenticateUser(input.email, "wrong-password"), null);
});

test("registration propagates duplicate-key and database failures", async (t) => {
  let failure: Error = Object.assign(new Error("duplicate key"), { code: 11000 });
  t.mock.method(User, "create", async () => { throw failure; });
  await assert.rejects(registerUser(input), (error) => error === failure);
  failure = new Error("database unavailable");
  await assert.rejects(registerUser(input), (error) => error === failure);
});

test("database failure during login is not reported as invalid credentials", async (t) => {
  const failure = new Error("database unavailable");
  t.mock.method(User, "findOne", () => ({
    select: async () => { throw failure; },
  }));
  await assert.rejects(authenticateUser(input.email, input.password), (error) => error === failure);
});

test("session creation stores a hashed token and expiry metadata", async (t) => {
  let persisted: Record<string, unknown> | undefined;
  t.mock.method(Session, "create", async (document: Record<string, unknown>) => {
    persisted = document;
    return undefined as never;
  });

  const beforeCreation = Date.now();
  const token = await createUserSession("507f1f77bcf86cd799439011", "node-test", "127.0.0.1");
  const afterCreation = Date.now();

  assert.match(token, /^[a-f0-9]{64}$/);
  assert.ok(persisted);
  assert.equal(persisted.userId, "507f1f77bcf86cd799439011");
  assert.equal(persisted.tokenHash, hashSessionToken(token));
  assert.equal(persisted.userAgent, "node-test");
  assert.equal(persisted.ipAddress, "127.0.0.1");
  assert.ok(persisted.expiresAt instanceof Date);

  const expiry = (persisted.expiresAt as Date).getTime();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  assert.ok(expiry >= beforeCreation + sevenDays);
  assert.ok(expiry <= afterCreation + sevenDays);
});

test("session revocation updates only active, unexpired matching sessions", async (t) => {
  let filter: Record<string, unknown> | undefined;
  let update: Record<string, unknown> | undefined;
  t.mock.method(Session, "updateOne", async (query: Record<string, unknown>, changes: Record<string, unknown>) => {
    filter = query;
    update = changes;
    return undefined as never;
  });

  const rawToken = "session-token-for-test";
  await revokeUserSession(rawToken);

  assert.ok(filter);
  assert.equal(filter.tokenHash, hashSessionToken(rawToken));
  assert.deepEqual(filter.revokedAt, { $exists: false });
  assert.ok(filter.expiresAt instanceof Object);
  assert.ok((filter.expiresAt as { $gt: Date }).$gt instanceof Date);
  assert.ok(update);
  assert.ok((update.$set as { revokedAt: Date }).revokedAt instanceof Date);
});
