// npm run vapid:generate  ->  prints the three env vars. Generate ONCE per environment and keep the
// private key secret: changing keys later silently invalidates every existing browser subscription.
import webpush from "web-push";

const { publicKey, privateKey } = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log("VAPID_SUBJECT=mailto:you@example.com   # a contact the push services can reach");
