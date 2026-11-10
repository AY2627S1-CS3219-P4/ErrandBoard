import assert from "node:assert/strict";
import { test } from "node:test";
import { DeleteMessageCommand, ReceiveMessageCommand } from "@aws-sdk/client-sqs";
import { User } from "../src/models/User.js";
import { hashVerificationToken } from "../src/services/email-verification.service.js";
import { verificationEmailQueue, verificationEmailSqsClient } from "../src/services/verification-email.queue.js";
import { verificationEmailSender } from "../src/services/verification-email.sender.js";

const token = "a".repeat(64);
const userId = "123456789012345678901234";

test("worker accepts a valid email once and deletes later duplicate deliveries", async (t) => {
  const previousUrl = process.env.VERIFICATION_EMAIL_QUEUE_URL;
  process.env.VERIFICATION_EMAIL_QUEUE_URL = "https://sqs.ap-southeast-1.amazonaws.com/123/verification";
  t.after(() => { if (previousUrl === undefined) delete process.env.VERIFICATION_EMAIL_QUEUE_URL; else process.env.VERIFICATION_EMAIL_QUEUE_URL = previousUrl; });
  const commands: unknown[] = [];
  t.mock.method(verificationEmailSqsClient, "send", async (command: unknown) => {
    commands.push(command);
    if (command instanceof ReceiveMessageCommand) return { Messages: [{ Body: JSON.stringify({ userId, token }), ReceiptHandle: "receipt" }] };
    return {};
  });
  let delivered = false;
  const lookup = t.mock.method(User, "findOne", async (filter: Record<string, unknown>) => {
    assert.equal(filter.emailVerificationTokenHash, hashVerificationToken(token));
    assert.ok((filter.emailVerificationExpiresAt as { $gt: Date }).$gt instanceof Date);
    return delivered ? null : new User({ email: "e1397822@u.nus.edu" });
  });
  const send = t.mock.method(verificationEmailSender, "send", async () => {});
  const mark = t.mock.method(User, "updateOne", async () => { delivered = true; return { matchedCount: 1 }; });
  assert.equal(await verificationEmailQueue.processOne(), true);
  assert.equal(await verificationEmailQueue.processOne(), true);
  assert.equal(send.mock.callCount(), 1);
  assert.deepEqual(send.mock.calls[0]?.arguments, ["e1397822@u.nus.edu", token]);
  assert.equal(mark.mock.callCount(), 1);
  assert.equal(lookup.mock.callCount(), 2);
  assert.equal(commands.filter((command) => command instanceof DeleteMessageCommand).length, 2);
});

test("SES failure leaves the message visible for retry and eventual DLQ redrive", async (t) => {
  const previousUrl = process.env.VERIFICATION_EMAIL_QUEUE_URL;
  process.env.VERIFICATION_EMAIL_QUEUE_URL = "https://sqs.ap-southeast-1.amazonaws.com/123/verification";
  t.after(() => { if (previousUrl === undefined) delete process.env.VERIFICATION_EMAIL_QUEUE_URL; else process.env.VERIFICATION_EMAIL_QUEUE_URL = previousUrl; });
  const commands: unknown[] = [];
  t.mock.method(verificationEmailSqsClient, "send", async (command: unknown) => {
    commands.push(command);
    if (command instanceof ReceiveMessageCommand) return { Messages: [{ Body: JSON.stringify({ userId, token }), ReceiptHandle: "receipt" }] };
    return {};
  });
  t.mock.method(User, "findOne", async () => new User({ email: "e1397822@u.nus.edu" }));
  t.mock.method(verificationEmailSender, "send", async () => { throw new Error("SES unavailable"); });
  await assert.rejects(verificationEmailQueue.processOne(), /SES unavailable/);
  assert.equal(commands.some((command) => command instanceof DeleteMessageCommand), false);
});

test("replaced or expired token is skipped and the stale queue message is deleted", async (t) => {
  const previousUrl = process.env.VERIFICATION_EMAIL_QUEUE_URL;
  process.env.VERIFICATION_EMAIL_QUEUE_URL = "https://sqs.ap-southeast-1.amazonaws.com/123/verification";
  t.after(() => { if (previousUrl === undefined) delete process.env.VERIFICATION_EMAIL_QUEUE_URL; else process.env.VERIFICATION_EMAIL_QUEUE_URL = previousUrl; });
  const commands: unknown[] = [];
  t.mock.method(verificationEmailSqsClient, "send", async (command: unknown) => {
    commands.push(command);
    if (command instanceof ReceiveMessageCommand) return { Messages: [{ Body: JSON.stringify({ userId, token }), ReceiptHandle: "receipt" }] };
    return {};
  });
  t.mock.method(User, "findOne", async () => null);
  const send = t.mock.method(verificationEmailSender, "send", async () => {});
  assert.equal(await verificationEmailQueue.processOne(), true);
  assert.equal(send.mock.callCount(), 0);
  assert.equal(commands.some((command) => command instanceof DeleteMessageCommand), true);
});
