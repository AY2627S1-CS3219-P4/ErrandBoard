import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { User } from "../src/models/User.js";

function validUser() {
    return {
        email: "e0000000@u.nus.edu",
        username: "John_Doe",
        passwordHash: "test-hash",
    };
}

test("accepts valid input and defaults accountType to USER", async() => {
    const user = new User(validUser());

    await user.validate();

    assert.equal(user.accountType, "USER");
})

test("normalizes email and trims username", async () => {
  const user = new User({
    ...validUser(),
    email: "  E0000000@U.NUS.EDU  ",
    username: "  John_Doe  ",
  });

  await user.validate();

  assert.equal(user.email, "e0000000@u.nus.edu");
  assert.equal(user.username, "John_Doe");
});

for (const field of ["email", "username", "passwordHash"] as const) {
  test(`rejects missing ${field}`, async () => {
    const user = new User({
      ...validUser(),
      [field]: undefined,
    });

    await assert.rejects(user.validate(), (error: unknown) => {
      assert.ok(error instanceof mongoose.Error.ValidationError);
      assert.ok(error.errors[field]);
      return true;
    });
  });
}

test("rejects an invalid email", async () => {
  const user = new User({
    ...validUser(),
    email: "not-an-email",
  });

  await assert.rejects(user.validate(), (error: unknown) => {
    assert.ok(error instanceof mongoose.Error.ValidationError);
    assert.ok(error.errors.email);
    return true;
  });
});

for (const username of ["ab", "a".repeat(31), "alice smith", "alice!"]) {
  test(`rejects invalid username: ${username}`, async () => {
    const user = new User({
      ...validUser(),
      username,
    });

    await assert.rejects(user.validate(), (error: unknown) => {
      assert.ok(error instanceof mongoose.Error.ValidationError);
      assert.ok(error.errors.username);
      return true;
    });
  });
}

test("rejects an unsupported account type", async () => {
  const user = new User({
    ...validUser(),
    accountType: "SUPERUSER",
  });

  await assert.rejects(user.validate(), (error: unknown) => {
    assert.ok(error instanceof mongoose.Error.ValidationError);
    assert.ok(error.errors.accountType);
    return true;
  });
});
