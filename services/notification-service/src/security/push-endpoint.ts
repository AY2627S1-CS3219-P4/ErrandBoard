export function isAllowedPushEndpoint(endpoint: unknown, allowedHosts: readonly string[]): endpoint is string {

  if (typeof endpoint !== "string" || endpoint.length > 2048) return false;

  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }

  if (url.protocol !== "https:" || url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;

  const host = url.hostname.toLowerCase();
  
  return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

const B64URL = /^[A-Za-z0-9_-]+$/;

export function isValidSubscriptionKeys(keys: unknown): keys is { p256dh: string; auth: string } {

  if (typeof keys !== "object" || keys === null) return false;

  const { p256dh, auth } = keys as Record<string, unknown>;

  return typeof p256dh === "string" && typeof auth === "string" &&
    p256dh.length >= 40 && p256dh.length <= 200 && B64URL.test(p256dh) &&
    auth.length >= 16 && auth.length <= 64 && B64URL.test(auth);
}