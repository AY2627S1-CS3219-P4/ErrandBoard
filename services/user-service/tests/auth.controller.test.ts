import assert from "node:assert/strict";
import { before, test, type TestContext } from "node:test";
import type { CookieOptions, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { changeUsername, changePassword, currentUser, login, logout, register } from "../src/controllers/auth.controller.js";
import { Session } from "../src/models/Session.js";
import { User } from "../src/models/User.js";
import { hashPassword } from "../src/security/password.js";
import { hashSessionToken } from "../src/security/session-token.js";
import { verifyAccessToken } from "../src/security/token.js";

// Small response double: no HTTP listener or database is required.
function responseDouble() {
  const state = {
    status: 200,
    body: undefined as unknown,
    cookies: [] as { name: string; value: string; options: CookieOptions }[],
    cleared: [] as { name: string; options: CookieOptions }[],
  };
  const response = {
    status(code: number) { state.status = code; return response; },
    json(body: unknown) { state.body = body; return response; },
    cookie(name: string, value: string, options: CookieOptions) {
      state.cookies.push({ name, value, options }); return response;
    },
    clearCookie(name: string, options: CookieOptions) {
      state.cleared.push({ name, options }); return response;
    },
    send() { return response; },
  };
  return { state, response: response as unknown as Response };
}

function setEnv(t: TestContext, key: string, value: string | undefined) {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  t.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
}

function requestDouble(
  body: Record<string, unknown>,
  cookies: Record<string, string> = {},
): Request {
  return {
    body,
    cookies,
    get(header: string) {
      return header.toLowerCase() === "user-agent" ? "node-test" : undefined;
    },
    ip: "127.0.0.1",
  } as unknown as Request;
}

const password = "Controller test password!";
const strongRegistrationPassword = "qf7$Lx2@vB9!Rk3#nP5^wM8";

test("account updates require a session cookie", async () => {
  for (const handler of [changeUsername, changePassword]) {
    const { state, response } = responseDouble();
    await handler(requestDouble({}), response);
    assert.equal(state.status, 401);
  }
});

test("account updates reject invalid inputs before database access", async (t) => {
  const lookup = t.mock.method(Session, "findOne", async () => null);
  const cases = [
    { handler: changeUsername, body: { username: "bad!", currentPassword: "existing" } },
    { handler: changePassword, body: { newPassword: "short", currentPassword: "existing" } },
    { handler: changePassword, body: { newPassword: 123, currentPassword: "existing" } },
  ];
  for (const { handler, body } of cases) {
    const { state, response } = responseDouble();
    await handler(requestDouble(body, { session_token: "test-token" }), response);
    assert.equal(state.status, 400);
  }
  assert.equal(lookup.mock.callCount(), 0);

  const { state, response } = responseDouble();
  await changeUsername({
    body: [],
    cookies: { session_token: "test-token" },
  } as unknown as Request, response);
  assert.equal(state.status, 400);
});

test("username update accepts an active session without asking for the current password", async (t) => {
  t.mock.method(Session, "findOne", async () => ({ userId: user._id }));
  t.mock.method(User, "findById", () => ({ select: async () => user }));
  t.mock.method(User, "findOneAndUpdate", async (filter: Record<string, unknown>, update: Record<string, unknown>) => {
    assert.equal(filter._id, user._id);
    assert.deepEqual(update, { $set: { username: "renamed" } });
    return new User({ ...user.toObject(), username: "renamed" });
  });
  const { state, response } = responseDouble();
  await changeUsername(requestDouble(
    { username: "renamed" },
    { session_token: "test-token" },
  ), response);
  assert.equal(state.status, 200);
  assert.deepEqual(state.body, {
    user: {
      id: user._id.toString(), email: user.email,
      username: "renamed", accountType: "USER",
    },
    message: "Username updated. Use your new username the next time you log in.",
  });
});

test("username update reports a duplicate username as a readable conflict", async (t) => {
  t.mock.method(Session, "findOne", async () => ({ userId: user._id }));
  t.mock.method(User, "findById", () => ({ select: async () => user }));
  t.mock.method(User, "findOneAndUpdate", async () => {
    throw { code: 11000, keyPattern: { username: 1 } };
  });
  const { state, response } = responseDouble();
  await changeUsername(requestDouble(
    { username: "taken_name" },
    { session_token: "test-token" },
  ), response);
  assert.equal(state.status, 409);
  assert.match((state.body as { error: string }).error, /username.*taken/i);
});

test("password update returns success without clearing the existing session cookies", async (t) => {
  t.mock.method(Session, "findOne", async () => ({ userId: user._id }));
  t.mock.method(User, "findById", () => ({ select: async () => user }));
  t.mock.method(User, "findOneAndUpdate", async () => user);
  const { state, response } = responseDouble();
  await changePassword(requestDouble(
    { newPassword: strongRegistrationPassword, currentPassword: password },
    { session_token: "test-token" },
  ), response);
  assert.equal(state.status, 200);
  assert.match((state.body as { message: string }).message, /Password updated/);
  assert.equal(state.cleared.length, 0);
  assert.equal(JSON.stringify(state.body).includes("passwordHash"), false);
});

let user: InstanceType<typeof User>;
before(async () => {
  user = new User({
    email: "alice@example.com", username: "alice",
    passwordHash: await hashPassword(password),
  });
});

test("registration returns 201 with a safe user response", async (t) => {
  let persisted: Record<string, unknown> | undefined;
  const create = t.mock.method(
    User,
    "create",
    async (document: Record<string, unknown>) => {
      persisted = document;
      const createdUser = new User(document);
      await createdUser.validate();
      return createdUser;
    },
  );
  const { state, response } = responseDouble();

  await register(
    {
      body: {
        email: " E0000000@U.NUS.EDU ",
        username: "alice_123",
        password: strongRegistrationPassword,
        accountType: "ADMIN",
      },
    } as Request,
    response,
  );

  assert.equal(state.status, 201);
  assert.ok(persisted);
  assert.deepEqual(Object.keys(persisted).sort(), ["email", "passwordHash", "username"]);
  assert.equal(persisted.email, "e0000000@u.nus.edu");
  assert.notEqual(persisted.passwordHash, strongRegistrationPassword);
  assert.equal(create.mock.callCount(), 1);

  const body = state.body as { user: Record<string, unknown> };
  assert.deepEqual(Object.keys(body.user).sort(), ["accountType", "email", "id", "username"]);
  assert.equal(body.user.accountType, "USER");
  assert.equal(body.user.email, "e0000000@u.nus.edu");
});

test("registration rejects invalid fields before hashing or persistence", async (t) => {
  const hash = t.mock.method(bcrypt, "hash", async () => "unexpected-hash");
  const create = t.mock.method(User, "create", async () => {
    throw new Error("must not persist invalid registration");
  });
  const { state, response } = responseDouble();

  await register(
    {
      body: {
        email: "not-an-email",
        username: "ab",
        password: "password123!password123!",
      },
    } as Request,
    response,
  );

  assert.equal(state.status, 400);
  assert.deepEqual(state.body, {
    error: "Invalid registration input",
    fields: {
      email: "Email must use the NUS student email format.",
      username: "Username must be 3–30 letters, numbers, or underscores.",
      password: "Password must be rated strong or better.",
    },
  });
  assert.equal(hash.mock.callCount(), 0);
  assert.equal(create.mock.callCount(), 0);
});

test("registration handles a missing or non-object request body as 400", async (t) => {
  const create = t.mock.method(User, "create", async () => {
    throw new Error("must not persist malformed body");
  });
  const { state, response } = responseDouble();

  await register({ body: null } as unknown as Request, response);

  assert.equal(state.status, 400);
  assert.deepEqual(state.body, {
    error: "Invalid registration input",
    fields: { body: "Expected a JSON object containing registration fields." },
  });
  assert.equal(create.mock.callCount(), 0);
});

test("registration maps MongoDB duplicate email and username errors to field-specific 409 responses", async (t) => {
  for (const [field, expectedMessage] of [
    ["email", "This email is already registered. Try logging in instead."],
    ["username", "This username is already taken. Please choose another."],
  ] as const) {
    const duplicate = Object.assign(new Error("duplicate key"), {
      code: 11000,
      keyPattern: { [field]: 1 },
    });
    t.mock.method(User, "create", async () => { throw duplicate; });
    const { state, response } = responseDouble();

    await register(requestDouble({
      email: "e1234567@u.nus.edu",
      username: "alice",
      password: strongRegistrationPassword,
    }), response);

    assert.equal(state.status, 409);
    assert.deepEqual(state.body, {
      error: "Registration conflict",
      fields: { [field]: expectedMessage },
    });
    t.mock.reset();
  }
});

test("current-user endpoint rejects a missing or expired/revoked session", async (t) => {
  const missing = responseDouble();
  await currentUser(requestDouble({}), missing.response);
  assert.equal(missing.state.status, 401);
  assert.deepEqual(missing.state.body, { error: "Not authenticated" });

  const findSession = t.mock.method(Session, "findOne", async () => null);
  const expired = responseDouble();
  await currentUser(requestDouble({}, { session_token: "opaque-token" }), expired.response);
  assert.equal(expired.state.status, 401);
  assert.deepEqual(expired.state.body, { error: "Session is invalid or expired" });

  const query = findSession.mock.calls[0]?.arguments[0] as Record<string, any>;
  assert.equal(query.tokenHash, hashSessionToken("opaque-token"));
  assert.deepEqual(query.revokedAt, { $exists: false });
  assert.ok(query.expiresAt.$gt instanceof Date);
});

test("current-user endpoint returns only safe user details for a valid session", async (t) => {
  const activeUser = new User({
    email: "e7654321@u.nus.edu", username: "activeuser", passwordHash: user.passwordHash,
  });
  t.mock.method(Session, "findOne", async () => ({ userId: activeUser._id }));
  t.mock.method(User, "findById", async () => activeUser);
  const { state, response } = responseDouble();

  await currentUser(requestDouble({}, { session_token: "valid-session" }), response);

  assert.equal(state.status, 200);
  assert.deepEqual(state.body, { user: {
    id: activeUser._id.toString(), email: activeUser.email,
    username: activeUser.username, accountType: "USER",
  } });
});

for (const mode of ["production", "development"]) {
  test(`login sets a protected cookie and logout clears its matching attributes (${mode})`, async (t) => {
    setEnv(t, "NODE_ENV", mode);
    setEnv(t, "JWT_SECRET", "controller-test-key-not-for-deployment-123456789");
    t.mock.method(User, "findOne", () => ({ select: async () => user }));
    t.mock.method(Session, "create", async () => undefined as never);
    t.mock.method(Session, "updateOne", async () => undefined as never);
    const { state, response } = responseDouble();
    const request = requestDouble({ username: user.username, password });

    await login(request, response);
    assert.equal(state.status, 200);
    assert.deepEqual(state.body, { user: {
      id: user._id.toString(), email: user.email,
      username: user.username, accountType: "USER",
    } });
    assert.equal(state.cookies.length, 2);
    const accessCookie = state.cookies.find((cookie) => cookie.name === "access_token");
    const sessionCookie = state.cookies.find((cookie) => cookie.name === "session_token");
    assert.ok(accessCookie);
    assert.ok(sessionCookie);
    assert.deepEqual(await verifyAccessToken(accessCookie.value), {
      userId: user._id.toString(), role: "USER",
    });
    assert.deepEqual(accessCookie.options, {
      httpOnly: true, secure: mode === "production", sameSite: "lax",
      maxAge: 900_000, path: "/",
    });
    assert.deepEqual(sessionCookie.options, {
      httpOnly: true, secure: mode === "production", sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, path: "/",
    });

    await logout(requestDouble(
      { email: user.email, password },
      { session_token: sessionCookie.value },
    ), response);
    assert.equal(state.status, 204);
    assert.deepEqual(
      state.cleared.map(({ name }) => name).sort(),
      ["access_token", "session_token"].sort(),
    );
  });
}

test("admin login issues a token carrying the ADMIN role", async (t) => {
  setEnv(t, "JWT_SECRET", "controller-test-key-not-for-deployment-123456789");
  const admin = new User({
    email: "admin@example.com", username: "admin",
    passwordHash: user.passwordHash, accountType: "ADMIN",
  });
  t.mock.method(User, "findOne", () => ({ select: async () => admin }));
  t.mock.method(Session, "create", async () => undefined as never);
  const { state, response } = responseDouble();

  await login(requestDouble({ username: admin.username, password }), response);
  assert.equal(state.status, 200);
  assert.equal((state.body as { user: { accountType: string } }).user.accountType, "ADMIN");
  const accessCookie = state.cookies.find((cookie) => cookie.name === "access_token");
  assert.ok(accessCookie);
  assert.deepEqual(await verifyAccessToken(accessCookie.value), {
    userId: admin._id.toString(), role: "ADMIN",
  });
});

test("failed login returns a generic 401 and never issues a cookie", async (t) => {
  let found: typeof user | null = null;
  t.mock.method(User, "findOne", () => ({ select: async () => found }));
  for (const account of [null, user]) {
    found = account;
    const { state, response } = responseDouble();
    await login(requestDouble({ username: user.username, password: "wrong" }), response);
    assert.equal(state.status, 401);
    assert.deepEqual(state.body, { error: "Invalid username or password" });
    assert.equal(state.cookies.length, 0);
  }
});

test("login rejects missing or malformed username and password before querying users", async (t) => {
  const lookup = t.mock.method(User, "findOne", () => ({ select: async () => user }));
  for (const body of [
    {},
    { username: "bad username", password },
    { username: "alice", password: "" },
    { username: "alice", password: "é".repeat(37) },
  ]) {
    const { state, response } = responseDouble();
    await login(requestDouble(body), response);
    assert.equal(state.status, 400);
    assert.deepEqual(state.body, { error: "Enter a valid username and password." });
    assert.equal(state.cookies.length, 0);
  }
  assert.equal(lookup.mock.callCount(), 0);
});

test("missing signing configuration rejects login before issuing a cookie or success body", async (t) => {
  setEnv(t, "JWT_SECRET", undefined);
  t.mock.method(User, "findOne", () => ({ select: async () => user }));
  const { state, response } = responseDouble();
  await assert.rejects(
    login(requestDouble({ username: user.username, password }), response),
    /JWT_SECRET is required/,
  );
  assert.equal(state.cookies.length, 0);
  assert.equal(state.body, undefined);
});
