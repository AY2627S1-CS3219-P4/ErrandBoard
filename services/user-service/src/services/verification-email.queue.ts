import { createHash } from "node:crypto";
import { DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { User } from "../models/User.js";
import { verificationEmailSender } from "./verification-email.sender.js";

export const verificationEmailSqsClient = new SQSClient({ region: process.env.AWS_REGION ?? "ap-southeast-1" });
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const USER_ID_PATTERN = /^[a-f0-9]{24}$/i;

function queueUrl(): string {
  const url = process.env.VERIFICATION_EMAIL_QUEUE_URL;
  if (!url) throw new Error("VERIFICATION_EMAIL_QUEUE_URL must be configured");
  return url;
}

function validJob(body: string | undefined): { userId: string; token: string } | null {
  if (!body) return null;
  try {
    const job: unknown = JSON.parse(body);
    if (typeof job !== "object" || job === null || Array.isArray(job)) return null;
    const { userId, token } = job as Record<string, unknown>;
    return typeof userId === "string" && USER_ID_PATTERN.test(userId) &&
      typeof token === "string" && TOKEN_PATTERN.test(token)
      ? { userId, token } : null;
  } catch {
    return null;
  }
}

export const verificationEmailQueue = {
  async enqueue(userId: string, token: string): Promise<void> {
    await verificationEmailSqsClient.send(new SendMessageCommand({
      QueueUrl: queueUrl(),
      MessageBody: JSON.stringify({ userId, token }),
    }));
  },

  async processOne(abortSignal?: AbortSignal): Promise<boolean> {
    const url = queueUrl();
    const response = await verificationEmailSqsClient.send(new ReceiveMessageCommand({
      QueueUrl: url,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20,
      VisibilityTimeout: 90,
    }), { abortSignal });
    const message = response.Messages?.[0];
    if (!message) return false;
    if (!message.ReceiptHandle) throw new Error("SQS returned a message without a receipt handle");

    const job = validJob(message.Body);
    if (job) {
      const tokenHash = createHash("sha256").update(job.token).digest("hex");
      const user = await User.findOne({
        _id: job.userId,
        emailVerified: false,
        emailVerificationTokenHash: tokenHash,
        emailVerificationExpiresAt: { $gt: new Date() },
        emailVerificationDeliveredTokenHash: { $ne: tokenHash },
      });
      if (user) {
        await verificationEmailSender.send(user.email, job.token);
        await User.updateOne(
          { _id: job.userId, emailVerificationTokenHash: tokenHash, emailVerified: false },
          { $set: { emailVerificationDeliveredTokenHash: tokenHash } },
        );
      }
    }

    await verificationEmailSqsClient.send(new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: message.ReceiptHandle }));
    return true;
  },
};

export function startVerificationEmailWorker(): () => Promise<void> {
  if (process.env.EMAIL_VERIFICATION_PROVIDER === "cognito" ||
      !process.env.VERIFICATION_EMAIL_QUEUE_URL || process.env.VERIFICATION_EMAIL_WORKER_ENABLED !== "true") return async () => {};
  let active = true;
  const abortController = new AbortController();
  const running = (async () => {
    while (active) {
      try {
        await verificationEmailQueue.processOne(abortController.signal);
      } catch (error) {
        if (!active) break;
        const name = error instanceof Error ? error.name : "UnknownError";
        console.error(`Verification email worker failed: ${name}`);
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
  })();
  return async () => {
    active = false;
    abortController.abort();
    await running;
  };
}
