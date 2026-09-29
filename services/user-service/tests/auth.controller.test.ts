import assert from "node:assert/strict";
import { before, test, type TestContext } from "node:test";
import type { CookieOptions, Request, Response } from "express";
import { login, logout } from "../src/controllers/auth.controller.js";
import { Session } from "../src/models/Session.js";
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
let user: InstanceType<typeof User>;
before(async () => {
  user = new User({
    email: "alice@example.com", username: "alice",
    passwordHash: await hashPassword(password),
  });
});

for (const mode of ["production", "development"]) {
  test(`login sets a protected cookie and logout clears its matching attributes (${mode})`, async (t) => {
    setEnv(t, "NODE_ENV", mode);
    setEnv(t, "JWT_SECRET", "controller-test-key-not-for-deployment-123456789");
    t.mock.method(User, "findOne", () => ({ select: async () => user }));
    t.mock.method(Session, "create", async () => undefined as never);
    t.mock.method(Session, "updateOne", async () => undefined as never);
    const { state, response } = responseDouble();
    const request = requestDouble({ email: user.email, password });

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

  await login(requestDouble({ email: admin.email, password }), response);
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
    await login(requestDouble({ email: user.email, password: "wrong" }), response);
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
    login(requestDouble({ email: user.email, password }), response),
    /JWT_SECRET is required/,
  );
  assert.equal(state.cookies.length, 0);
  assert.equal(state.body, undefined);
});
