import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";

const ses = new SESv2Client({ region: process.env.AWS_REGION ?? "ap-southeast-1" });

export function confirmationUrl(token: string): string {
  const origin = process.env.PUBLIC_APP_ORIGIN;
  if (!origin) throw new Error("PUBLIC_APP_ORIGIN must be configured for verification email");
  const parsed = new URL(origin);
  const localHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname);
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash ||
      (process.env.NODE_ENV === "production" && parsed.protocol !== "https:" && !localHttp) ||
      (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
    throw new Error("PUBLIC_APP_ORIGIN must be a trusted web origin");
  }
  const link = new URL("/confirm-email", parsed);
  // The fragment is not sent to the web server on the initial page request.
  link.hash = new URLSearchParams({ token }).toString();
  return link.toString();
}

export async function sendPlainEmail(address: string, subject: string, body: string): Promise<void> {
  const from = process.env.SES_FROM_EMAIL;
  if (!from) throw new Error("SES_FROM_EMAIL must be configured for verification email");
  await ses.send(new SendEmailCommand({
    FromEmailAddress: from,
    Destination: { ToAddresses: [address] },
    Content: { Simple: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: { Text: { Data: body, Charset: "UTF-8" } },
    } },
  }));
}

export const verificationEmailSender = {
  async send(address: string, token: string): Promise<void> {
    const link = confirmationUrl(token);
    await sendPlainEmail(address, "Confirm your ErrandBoard email",
      `Confirm your ErrandBoard email by opening this link:\n\n${link}\n\nThis link expires in 24 hours. If you did not register, you can ignore this message.`);
  },
};
