import assert from "node:assert/strict";
import { before, test, type TestContext } from "node:test";
import type { CookieOptions, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { login, logout, register } from "../src/controllers/auth.controller.js";
import { User } from "../src/models/User.js";
import { hashPassword } from "../src/security/password.js";
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

const password = "Controller test password!";
const strongRegistrationPassword = "qf7$Lx2@vB9!Rk3#nP5^wM8";
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

for (const mode of ["production", "development"]) {
  test(`login sets a protected cookie and logout clears its matching attributes (${mode})`, async (t) => {
    setEnv(t, "NODE_ENV", mode);
    setEnv(t, "JWT_SECRET", "controller-test-key-not-for-deployment-123456789");
    t.mock.method(User, "findOne", () => ({ select: async () => user }));
    const { state, response } = responseDouble();
    const request = { body: { email: user.email, password } } as Request;

    await login(request, response);
    assert.equal(state.status, 200);
    assert.deepEqual(state.body, { user: {
      id: user._id.toString(), email: user.email,
      username: user.username, accountType: "USER",
    } });
    assert.equal(state.cookies.length, 1);
    const cookie = state.cookies[0]!;
    assert.equal(cookie.name, "access_token");
    assert.deepEqual(await verifyAccessToken(cookie.value), {
      userId: user._id.toString(), role: "USER",
    });
    assert.deepEqual(cookie.options, {
      httpOnly: true, secure: mode === "production", sameSite: "lax",
      maxAge: 900_000, path: "/",
    });

    logout(request, response);
    assert.equal(state.status, 204);
    const { maxAge: _maxAge, ...matchingOptions } = cookie.options;
    assert.deepEqual(state.cleared, [{ name: cookie.name, options: matchingOptions }]);
  });
}

test("admin login issues a token carrying the ADMIN role", async (t) => {
  setEnv(t, "JWT_SECRET", "controller-test-key-not-for-deployment-123456789");
  const admin = new User({
    email: "admin@example.com", username: "admin",
    passwordHash: user.passwordHash, accountType: "ADMIN",
  });
  t.mock.method(User, "findOne", () => ({ select: async () => admin }));
  const { state, response } = responseDouble();

  await login({ body: { email: admin.email, password } } as Request, response);
  assert.equal(state.status, 200);
  assert.equal((state.body as { user: { accountType: string } }).user.accountType, "ADMIN");
  const token = state.cookies[0]!.value;
  assert.deepEqual(await verifyAccessToken(token), {
    userId: admin._id.toString(), role: "ADMIN",
  });
});

test("failed login returns a generic 401 and never issues a cookie", async (t) => {
  let found: typeof user | null = null;
  t.mock.method(User, "findOne", () => ({ select: async () => found }));
  for (const account of [null, user]) {
    found = account;
    const { state, response } = responseDouble();
    await login({ body: { email: user.email, password: "wrong" } } as Request, response);
    assert.equal(state.status, 401);
    assert.deepEqual(state.body, { error: "Invalid email or password" });
    assert.equal(state.cookies.length, 0);
  }
});

test("missing signing configuration rejects login before issuing a cookie or success body", async (t) => {
  setEnv(t, "JWT_SECRET", undefined);
  t.mock.method(User, "findOne", () => ({ select: async () => user }));
  const { state, response } = responseDouble();
  await assert.rejects(
    login({ body: { email: user.email, password } } as Request, response),
    /JWT_SECRET is required/,
  );
  assert.equal(state.cookies.length, 0);
  assert.equal(state.body, undefined);
});
