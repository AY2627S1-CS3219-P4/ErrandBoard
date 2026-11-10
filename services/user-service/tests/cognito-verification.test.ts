import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { AdminDeleteUserCommand, AdminGetUserCommand, ResendConfirmationCodeCommand, SignUpCommand } from "@aws-sdk/client-cognito-identity-provider";
import { User } from "../src/models/User.js";
import { cognitoClient, completeCognitoVerification, requestCognitoVerification } from "../src/services/cognito-verification.service.js";

const poolId = "ap-southeast-1_testpool";
const sub = "895a85ac-f0d1-704e-1c61-6497db5cb898";
const email = "e1397822@u.nus.edu";

function configure(t: TestContext) {
  const prior = { ...process.env };
  process.env.COGNITO_USER_POOL_ID = poolId;
  process.env.COGNITO_APP_CLIENT_ID = "test-client";
  process.env.COGNITO_APP_CLIENT_SECRET = "test-secret";
  t.after(() => { process.env = prior; });
}

test("registration asks Cognito to email a link without passing the ErrandBoard password", async (t) => {
  configure(t);
  const user = new User({ email, username: "test", passwordHash: "errandboard-hash", emailVerified: false });
  t.mock.method(User, "findOneAndUpdate", () => ({ select: async () => user }));
  const saved = t.mock.method(User, "updateOne", async () => ({ matchedCount: 1 }));
  const calls: unknown[] = [];
  t.mock.method(cognitoClient, "send", async (command: unknown) => {
    calls.push(command);
    return { UserSub: sub, UserConfirmed: false };
  });
  assert.equal(await requestCognitoVerification(` ${email.toUpperCase()} `, "initial"), true);
  const command = calls[0] as SignUpCommand;
  assert.ok(command instanceof SignUpCommand);
  assert.equal(command.input.Username, email);
  assert.notEqual(command.input.Password, "errandboard-hash");
  assert.equal(command.input.UserAttributes?.[0]?.Value, email);
  assert.equal((saved.mock.calls[0]?.arguments[1] as { $set: { cognitoVerificationSub: string } }).$set.cognitoVerificationSub, sub);
});

test("confirmation verifies the Cognito record before marking MongoDB and deleting it", async (t) => {
  configure(t);
  const user = new User({ email, username: "test", passwordHash: "hash", emailVerified: false, cognitoVerificationSub: sub });
  t.mock.method(User, "findOne", () => ({ select: async () => user }));
  const updates = t.mock.method(User, "updateOne", async () => ({ matchedCount: 1 }));
  const calls: unknown[] = [];
  t.mock.method(cognitoClient, "send", async (command: unknown) => {
    calls.push(command);
    if (command instanceof AdminGetUserCommand) return {
      UserStatus: "CONFIRMED",
      UserAttributes: [
        { Name: "sub", Value: sub }, { Name: "email", Value: email }, { Name: "email_verified", Value: "true" },
      ],
    };
    return {};
  });
  assert.equal(await completeCognitoVerification(poolId, sub), true);
  assert.ok(calls[0] instanceof AdminGetUserCommand);
  assert.equal((updates.mock.calls[0]?.arguments[1] as { $set: { emailVerified: boolean } }).$set.emailVerified, true);
  assert.ok(calls[1] instanceof AdminDeleteUserCommand);
});

test("a duplicate confirmation after deletion is acknowledged only for a verified account", async (t) => {
  configure(t);
  const user = new User({ email, username: "test", passwordHash: "hash", emailVerified: true, cognitoVerificationSub: sub });
  t.mock.method(User, "findOne", () => ({ select: async () => user }));
  const updates = t.mock.method(User, "updateOne", async () => ({ matchedCount: 1 }));
  t.mock.method(cognitoClient, "send", async () => { throw Object.assign(new Error("gone"), { name: "UserNotFoundException" }); });
  assert.equal(await completeCognitoVerification(poolId, sub), true);
  assert.equal(updates.mock.callCount(), 0);
});

test("a resend reconciles a confirmed Cognito account without sending another email", async (t) => {
  configure(t);
  const user = new User({ email, username: "test", passwordHash: "hash", emailVerified: false, cognitoVerificationSub: sub });
  t.mock.method(User, "findOneAndUpdate", () => ({ select: async () => user }));
  t.mock.method(User, "findOne", () => ({ select: async () => user }));
  t.mock.method(User, "updateOne", async () => ({ matchedCount: 1 }));
  const calls: unknown[] = [];
  t.mock.method(cognitoClient, "send", async (command: unknown) => {
    calls.push(command);
    if (command instanceof AdminGetUserCommand) return {
      UserStatus: "CONFIRMED",
      UserAttributes: [
        { Name: "sub", Value: sub }, { Name: "email", Value: email }, { Name: "email_verified", Value: "true" },
      ],
    };
    return {};
  });
  assert.equal(await requestCognitoVerification(email), true);
  assert.equal(calls.filter((command) => command instanceof ResendConfirmationCodeCommand).length, 0);
  assert.equal(calls.filter((command) => command instanceof AdminDeleteUserCommand).length, 1);
});
