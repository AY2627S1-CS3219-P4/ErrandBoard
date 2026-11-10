import { NOTIFICATION_API_BASE_URL, ORDER_API_BASE_URL } from "../api/client.ts";
import { deleteSubscription, fetchVapidPublicKey, saveSubscription } from "./api.ts";

export type PushState = "unsupported" | "needs-install" | "denied" | "default" | "granted";

/** Everything getPushState needs from the browser, so the decision itself is a pure function. */
export interface PushEnv {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  standalone: boolean;
  serviceWorker: boolean;
  pushManager: boolean;
  /** null when the Notification API does not exist */
  permission: NotificationPermission | null;
}

export function classifyPush(env: PushEnv): PushState {
  // iPadOS reports itself as a Mac, but a Mac has no touch screen.
  const ios = /iPad|iPhone|iPod/.test(env.userAgent) || (env.platform === "MacIntel" && env.maxTouchPoints > 1);
  // iOS/iPadOS only exposes Web Push to a web app that was added to the Home Screen.
  if (ios && !env.standalone) return "needs-install";
  if (!env.serviceWorker || !env.pushManager || env.permission === null) return "unsupported";
  if (env.permission === "granted") return "granted";
  return env.permission === "denied" ? "denied" : "default";
}

export function readPushEnv(): PushEnv {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { userAgent: "", platform: "", maxTouchPoints: 0, standalone: false, serviceWorker: false, pushManager: false, permission: null };
  }
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: (navigator as { standalone?: boolean }).standalone === true ||
      window.matchMedia?.("(display-mode: standalone)").matches === true,
    // both are missing on insecure (plain http, non-localhost) origins
    serviceWorker: "serviceWorker" in navigator,
    pushManager: "PushManager" in window,
    permission: "Notification" in window ? Notification.permission : null,
  };
}

export const getPushState = (): PushState => classifyPush(readPushEnv());

export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url + "=".repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export function sameKey(existing: ArrayBuffer | null | undefined, wanted: Uint8Array): boolean {
  if (!existing) return false;
  const a = new Uint8Array(existing);
  return a.length === wanted.length && a.every((byte, index) => byte === wanted[index]);
}

// ---- opt-out: a user who turned notifications off must stay off after a reload ----
const OPT_OUT_KEY = "errandboard:push-opt-out";
function isOptedOut(): boolean {
  try { return localStorage.getItem(OPT_OUT_KEY) === "1"; } catch { return false; }
}
function setOptedOut(value: boolean): void {
  try {
    if (value) localStorage.setItem(OPT_OUT_KEY, "1"); else localStorage.removeItem(OPT_OUT_KEY);
  } catch { /* storage unavailable: worst case the choice does not persist */ }
}

/**
 * Registers /sw.js. The query tells the worker where the Order and Notification APIs live.
 * Safe to call repeatedly: registering the same script again returns the existing registration.
 */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return Promise.resolve(null);
  const query = new URLSearchParams({ api: ORDER_API_BASE_URL, notif: NOTIFICATION_API_BASE_URL });
  return navigator.serviceWorker.register(`/sw.js?${query}`).catch(() => null);
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration("/");
  return (await existing?.pushManager?.getSubscription()) ?? null;
}

export async function isPushSubscribed(): Promise<boolean> {
  try { return (await currentSubscription()) !== null; } catch { return false; }
}

/** Creates (or refreshes) this browser's subscription and binds it to the signed-in user. */
async function subscribeThisBrowser(): Promise<void> {
  const reg = await registerServiceWorker();
  if (!reg) throw new Error("Service workers are not available");
  await navigator.serviceWorker.ready;

  const key = urlBase64ToUint8Array(await fetchVapidPublicKey());
  let subscription = await reg.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options.applicationServerKey, key)) {
    await subscription.unsubscribe(); // the server's VAPID keys changed, so the old subscription is dead
    subscription = null;
  }
  subscription ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  // Saving is also what moves a shared browser's subscription to whoever is signed in now.
  await saveSubscription(subscription.toJSON());
}

/** Must run from a click: the permission prompt needs a user gesture. */
export async function enablePush(): Promise<PushState> {
  const state = getPushState();
  if (state !== "default" && state !== "granted") return state;
  if (state === "default" && await Notification.requestPermission() !== "granted") return getPushState();
  setOptedOut(false);
  await subscribeThisBrowser();
  return getPushState();
}

/** Runs on app start. Re-binds an existing grant to the current user and repairs rotated subscriptions. */
export async function syncPushSubscription(): Promise<void> {
  if (getPushState() !== "granted" || isOptedOut()) return;
  await subscribeThisBrowser();
}

/** User turned notifications off for this device. Server first (it needs the session), then the browser. */
export async function disablePush(): Promise<void> {
  const subscription = await currentSubscription();
  if (subscription) {
    await deleteSubscription(subscription.endpoint);
    await subscription.unsubscribe();
  }
  // Only once it really is off: a failure above leaves the opt-out unset and the UI showing "on".
  setOptedOut(true);
}

/**
 * Called just BEFORE logout while the session cookie still works. Best effort and time-boxed: it must
 * never block or fail a logout. Does not set the opt-out, so the next sign-in re-subscribes by itself.
 */
export async function releasePushForLogout(timeoutMs = 3000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); });
  const work = (async () => {
    const subscription = await currentSubscription();
    if (!subscription) return;
    await deleteSubscription(subscription.endpoint).catch(() => undefined);
    await subscription.unsubscribe().catch(() => undefined);
  })().catch(() => undefined);
  try {
    await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
