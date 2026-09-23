import assert from "node:assert/strict";
import { before, test, type TestContext } from "node:test";
import type { CookieOptions, Request, Response } from "express";
import { login, logout } from "../src/controllers/auth.controller.js";
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
    assert.equal(await verifyAccessToken(cookie.value), user._id.toString());
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
