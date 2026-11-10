import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { settings } from "../src/config/settings.js";
import { isAllowedPushEndpoint, isValidSubscriptionKeys } from "../src/security/push-endpoint.js";

const hosts = settings.pushHostAllowlist;
const ok = (u: unknown) => isAllowedPushEndpoint(u, hosts);

describe("isAllowedPushEndpoint (SSRF guard)", () => {
  test("accepts the real push services used by each browser", () => {
    for (const u of [
      "https://fcm.googleapis.com/fcm/send/abc",                          // Chrome / Edge / Brave / Samsung
      "https://updates.push.services.mozilla.com/wpush/v2/abc",           // Firefox
      "https://web.push.apple.com/QGxyz",                                 // Safari / iOS
      "https://wns2-par02p.notify.windows.com/w/?token=abc",              // Edge on Windows
    ]) assert.equal(ok(u), true, u);
  });

  test("rejects internal and arbitrary hosts", () => {
    for (const u of [
      "http://credit-service:3004/credit/reservations",
      "https://credit-service:3004/x",
      "http://169.254.169.254/latest/meta-data/",
      "https://localhost/x",
      "https://example.com/x",
      "https://evil.test/fcm.googleapis.com",
    ]) assert.equal(ok(u), false, u);
  });

  test("rejects lookalike hosts that merely contain or end with an allowed name", () => {
    assert.equal(ok("https://fcm.googleapis.com.evil.test/x"), false);
    assert.equal(ok("https://notfcm.googleapis.com.test/x"), false);
    assert.equal(ok("https://evilpush.apple.com.attacker.io/x"), false);
    assert.equal(ok("https://xpush.apple.com/x"), false); // suffix without a dot boundary
  });

  test("rejects non-https, credentials, odd ports, junk and over-long values", () => {
    assert.equal(ok("http://fcm.googleapis.com/x"), false);
    assert.equal(ok("https://user:pw@fcm.googleapis.com/x"), false);
    assert.equal(ok("https://fcm.googleapis.com:8443/x"), false);
    assert.equal(ok("not a url"), false);
    assert.equal(ok(undefined), false);
    assert.equal(ok(`https://fcm.googleapis.com/${"a".repeat(2100)}`), false);
  });

  test("the allowlist can be overridden from the environment", () => {
    process.env.PUSH_ENDPOINT_ALLOWLIST = "push.example.org, other.test";
    try {
      assert.deepEqual(settings.pushHostAllowlist, ["push.example.org", "other.test"]);
      assert.equal(isAllowedPushEndpoint("https://a.push.example.org/x", settings.pushHostAllowlist), true);
      assert.equal(isAllowedPushEndpoint("https://fcm.googleapis.com/x", settings.pushHostAllowlist), false);
    } finally { delete process.env.PUSH_ENDPOINT_ALLOWLIST; }
  });
});

describe("isValidSubscriptionKeys", () => {
  const good = { p256dh: "B".repeat(87), auth: "a".repeat(22) };
  test("accepts base64url keys of realistic length", () => assert.equal(isValidSubscriptionKeys(good), true));
  test("rejects missing, short, long and non-base64url keys", () => {
    for (const k of [undefined, null, {}, { p256dh: "x", auth: "y" }, { ...good, auth: "a".repeat(100) }, { ...good, p256dh: "!".repeat(87) }, { p256dh: 1, auth: 2 }])
      assert.equal(isValidSubscriptionKeys(k), false);
  });
});
