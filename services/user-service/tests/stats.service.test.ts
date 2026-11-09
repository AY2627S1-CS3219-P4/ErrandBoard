import assert from "node:assert/strict";
import { test } from "node:test";
import { User } from "../src/models/User.js";
import { getUserStats } from "../src/services/stats.service.js";

test("getUserStats returns totals, active/inactive, and a role breakdown", async (t) => {
  // countDocuments is called for active (isActive != false) then inactive (isActive == false)
  let countCall = 0;
  t.mock.method(User, "countDocuments", async () => (countCall++ === 0 ? 40 : 2));
  t.mock.method(User, "aggregate", async () => [
    { _id: "USER", count: 35 },
    { _id: "ADMIN", count: 5 },
    { _id: "SUPERADMIN", count: 2 },
  ]);

  const stats = await getUserStats();

  assert.equal(stats.totalUsers, 42); // active + inactive
  assert.equal(stats.activeUsers, 40);
  assert.equal(stats.inactiveUsers, 2);
  assert.equal(stats.users, 35);
  assert.equal(stats.admins, 5);
  assert.equal(stats.superadmins, 2);
});

test("getUserStats yields all zeros when there are no users", async (t) => {
  t.mock.method(User, "countDocuments", async () => 0);
  t.mock.method(User, "aggregate", async () => []);

  const stats = await getUserStats();

  assert.equal(stats.totalUsers, 0);
  assert.equal(stats.activeUsers, 0);
  assert.equal(stats.inactiveUsers, 0);
  assert.equal(stats.users, 0);
  assert.equal(stats.admins, 0);
  assert.equal(stats.superadmins, 0);
});
