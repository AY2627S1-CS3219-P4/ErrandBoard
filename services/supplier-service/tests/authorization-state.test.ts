import assert from "node:assert/strict";
import { test } from "node:test";
import { decideAuthorization } from "../src/security/authorization-state.js";

const adminToken = { userId: "507f1f77bcf86cd799439011", role: "ADMIN" as const, authzVersion: 2 };

test("supplier authorization rejects stale role, deactivated accounts, and older token versions", () => {
  assert.equal(decideAuthorization({ version: 2, role: "ADMIN", active: true, blocked: false }, adminToken), "allowed");
  assert.equal(decideAuthorization({ version: 3, role: "USER", active: true, blocked: false }, adminToken), "revoked");
  assert.equal(decideAuthorization({ version: 3, role: "ADMIN", active: true, blocked: false }, adminToken), "revoked");
  assert.equal(decideAuthorization({ version: 3, role: "ADMIN", active: false, blocked: false }, adminToken), "inactive");
  assert.equal(decideAuthorization({ version: 2, role: "ADMIN", active: true, blocked: true }, adminToken), "revoked");
});

test("missing or malformed shared state never grants access", () => {
  for (const state of [null, {}, { version: "2", role: "ADMIN", active: true, blocked: false }]) {
    assert.equal(decideAuthorization(state, adminToken), "unavailable");
  }
});
