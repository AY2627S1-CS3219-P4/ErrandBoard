import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { completeCognitoVerification } from "./cognito-verification.service.js";

export const cognitoQueueClient = new SQSClient({ region: process.env.AWS_REGION ?? "ap-southeast-1" });

function queueUrl(): string {
  const url = process.env.COGNITO_CONFIRMATION_QUEUE_URL;
  if (!url) throw new Error("COGNITO_CONFIRMATION_QUEUE_URL must be configured");
  return url;
}

function validJob(body: string | undefined): { poolId: string; sub: string } {
  if (!body) throw new Error("Empty Cognito confirmation message");
  const job: unknown = JSON.parse(body);
  if (typeof job !== "object" || job === null || Array.isArray(job)) throw new Error("Invalid Cognito confirmation message");
  const { poolId, sub } = job as Record<string, unknown>;
  if (typeof poolId !== "string" || typeof sub !== "string" || !/^[0-9a-f-]{36}$/i.test(sub)) {
    throw new Error("Invalid Cognito confirmation identity");
  }
  return { poolId, sub };
}

export const cognitoConfirmationQueue = {
  async processOne(abortSignal?: AbortSignal): Promise<boolean> {
    const url = queueUrl();
    const response = await cognitoQueueClient.send(new ReceiveMessageCommand({
      QueueUrl: url, MaxNumberOfMessages: 1, WaitTimeSeconds: 20, VisibilityTimeout: 90,
    }), { abortSignal });
    const message = response.Messages?.[0];
    if (!message) return false;
    if (!message.ReceiptHandle) throw new Error("SQS message has no receipt handle");
    const job = validJob(message.Body);
    await completeCognitoVerification(job.poolId, job.sub);
    await cognitoQueueClient.send(new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: message.ReceiptHandle }));
    return true;
  },
};

export function startCognitoConfirmationWorker(): () => Promise<void> {
  if (process.env.EMAIL_VERIFICATION_PROVIDER !== "cognito" ||
      process.env.COGNITO_CONFIRMATION_WORKER_ENABLED !== "true" ||
      !process.env.COGNITO_CONFIRMATION_QUEUE_URL) return async () => {};
  let active = true;
  const abortController = new AbortController();
  const running = (async () => {
    while (active) {
      try {
        await cognitoConfirmationQueue.processOne(abortController.signal);
      } catch (error) {
        if (!active) break;
        console.error("Cognito confirmation worker failed:", error instanceof Error ? error.name : "UnknownError");
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
  })();
  return async () => { active = false; abortController.abort(); await running; };
}
