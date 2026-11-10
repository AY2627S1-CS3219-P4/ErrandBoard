import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import { User } from "../src/models/User.js";
import { Session } from "../src/models/Session.js";
import { authorizationStore } from "../src/security/authorization-state.js";
import { logger } from "../src/logger.js";
import { updateAccountRole, updateAccountStatus } from "../src/controllers/account.controller.js";

// Minimal Express response stub.
function mockResponse() {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
  };
  return res;
}

const superadmin = { userId: "superadmin-1", role: "SUPERADMIN", authzVersion: 0 };

// A managed account document, as the service loads and returns it. _id has a
// toString() like a real ObjectId; methods used by changeAuthorization are stubbed.
function managedAccount(overrides: Record<string, unknown> = {}) {
  return {
    _id: { toString: () => "target-1" },
    email: "e1234567@u.nus.edu",
    username: "target",
    accountType: "USER",
    isActive: true,
    authzVersion: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

// Stub the whole changeAuthorization dependency chain so a role/status change
// "succeeds" and returns the updated account, letting us assert the controller's
// audit log without a live Redis/Mongo.
function stubSuccessfulChange(t: TestContext, updated: Record<string, unknown>) {
  t.mock.method(authorizationStore, "block", async () => ({ version: 0, role: "USER", active: true, blocked: false }));
  t.mock.method(authorizationStore, "publish", async () => {});
  t.mock.method(authorizationStore, "restore", async () => {});
  t.mock.method(Session, "updateMany", async () => ({}));
  t.mock.method(User, "findOneAndUpdate", async () => updated);
}

// Stub the controller's pre-change read: User.findById(id).select(...).lean().
// `before` is the account as it looked before the change (or null if missing).
function stubBefore(t: TestContext, before: Record<string, unknown> | null) {
  t.mock.method(User, "findById", () => ({ select: () => ({ lean: async () => before }) }) as never);
}

test("updateAccountRole emits an account.role_changed audit event with actor and target", async (t) => {
  const current = managedAccount({ accountType: "USER" });
  t.mock.method(User, "findOne", async () => current);
  stubSuccessfulChange(t, managedAccount({ accountType: "ADMIN" }));
  stubBefore(t, { username: "target", accountType: "USER", isActive: true });
  const info = t.mock.method(logger, "info", () => logger);

  const req = {
    params: { id: "target-1" },
    body: { accountType: "ADMIN" },
    user: superadmin,
  } as unknown as ExpressRequest;
  const res = mockResponse();
  await updateAccountRole(req, res as unknown as ExpressResponse);

  assert.equal(res.statusCode, 200);
  assert.equal(info.mock.callCount(), 1);
  assert.deepEqual(info.mock.calls[0].arguments[0], {
    event: "account.role_changed",
    adminId: "superadmin-1",
    targetUserId: "target-1",
    targetUsername: "target",
    oldRole: "USER",
    newRole: "ADMIN",
  });
});

test("updateAccountStatus emits an account.status_changed audit event", async (t) => {
  // A status change also syncs the Credit Service; stub fetch to a 204 so that
  // call succeeds without a live service, and point the client at a base URL.
  process.env.CREDIT_SERVICE_URL = "http://credit.test";
  process.env.CREDIT_INTERNAL_API_KEY = "test-key";
  t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 204 }));

  const current = managedAccount({ isActive: true });
  t.mock.method(User, "findOne", async () => current);
  stubSuccessfulChange(t, managedAccount({ isActive: false }));
  stubBefore(t, { username: "target", accountType: "USER", isActive: true });
  const info = t.mock.method(logger, "info", () => logger);

  const req = {
    params: { id: "target-1" },
    body: { isActive: false },
    user: superadmin,
  } as unknown as ExpressRequest;
  const res = mockResponse();
  await updateAccountStatus(req, res as unknown as ExpressResponse);

  assert.equal(res.statusCode, 200);
  assert.equal(info.mock.callCount(), 1);
  assert.deepEqual(info.mock.calls[0].arguments[0], {
    event: "account.status_changed",
    adminId: "superadmin-1",
    targetUserId: "target-1",
    targetUsername: "target",
    isActive: false,
  });
});

test("a change to a missing account emits a rejected warning, not a success event", async (t) => {
  // updateManagedAccount returns null when no USER/ADMIN matches the id.
  t.mock.method(User, "findOne", async () => null);
  stubBefore(t, null); // the pre-change read also finds nothing
  const info = t.mock.method(logger, "info", () => logger);
  const warn = t.mock.method(logger, "warn", () => logger);

  const req = {
    params: { id: "missing" },
    body: { accountType: "ADMIN" },
    user: superadmin,
  } as unknown as ExpressRequest;
  const res = mockResponse();
  await updateAccountRole(req, res as unknown as ExpressResponse);

  assert.equal(res.statusCode, 404);
  assert.equal(info.mock.callCount(), 0);
  assert.equal(warn.mock.callCount(), 1);
  const ctx = warn.mock.calls[0].arguments[0] as Record<string, unknown>;
  assert.equal(ctx.event, "account.role_change_rejected");
  assert.equal(ctx.adminId, "superadmin-1");
  assert.equal(ctx.reason, "account_not_found");
});

test("an authorization failure emits a rejected warning with the status", async (t) => {
  // block() failing surfaces as a 503 AuthorizationChangeError from the service.
  const current = managedAccount({ isActive: true });
  t.mock.method(User, "findOne", async () => current);
  stubBefore(t, { username: "target", accountType: "USER", isActive: true });
  t.mock.method(authorizationStore, "block", async () => { throw new Error("redis down"); });
  const warn = t.mock.method(logger, "warn", () => logger);

  const req = {
    params: { id: "target-1" },
    body: { isActive: false },
    user: superadmin,
  } as unknown as ExpressRequest;
  const res = mockResponse();
  await updateAccountStatus(req, res as unknown as ExpressResponse);

  assert.equal(res.statusCode, 503);
  assert.equal(warn.mock.callCount(), 1);
  const ctx = warn.mock.calls[0].arguments[0] as Record<string, unknown>;
  assert.equal(ctx.event, "account.status_change_rejected");
  assert.equal(ctx.reason, "authorization_change_error");
  assert.equal(ctx.status, 503);
  assert.equal(ctx.targetUsername, "target");
});
