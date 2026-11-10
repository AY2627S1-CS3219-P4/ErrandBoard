import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

const sqs = new SQSClient({ region: process.env.AWS_REGION ?? "ap-southeast-1" });

export async function handler(event) {
  if (event.triggerSource !== "PostConfirmation_ConfirmSignUp") return event;
  const poolId = process.env.COGNITO_USER_POOL_ID;
  const queueUrl = process.env.COGNITO_CONFIRMATION_QUEUE_URL;
  const sub = event.request?.userAttributes?.sub;
  if (event.userPoolId !== poolId || !queueUrl ||
      typeof sub !== "string" || !/^[0-9a-f-]{36}$/i.test(sub) ||
      event.request?.userAttributes?.email_verified !== "true") {
    throw new Error("Invalid Cognito confirmation event or configuration");
  }
  await sqs.send(new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify({ poolId, sub }),
  }));
  return event;
}
