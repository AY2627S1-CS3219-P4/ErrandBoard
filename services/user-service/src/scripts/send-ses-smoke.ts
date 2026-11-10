import { sendPlainEmail } from "../services/verification-email.sender.js";

const address = process.env.SES_SMOKE_TO_EMAIL;
if (!address || address !== process.env.SES_FROM_EMAIL) {
  throw new Error("SES_SMOKE_TO_EMAIL must equal the verified test sender");
}

await sendPlainEmail(address, "ErrandBoard SES private test",
  "This is a private SES connectivity test from the ErrandBoard user service. No action is needed.");
console.log("SES smoke email accepted");
