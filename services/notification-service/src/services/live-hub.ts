import type { Response } from "express";
import type { NotificationView } from "../types/notification.types.js";

type SseResponse = Pick<Response, "status" | "set" | "flushHeaders" | "write" | "end" | "on" | "writable" | "writableEnded">;

export interface LiveHubOptions {
  heartbeatMs: number;
  //streams are given a lifespan, reason being that tokens expire eventually and the stream is verified with that token that will expire
  //as such the stream itself should also refresh along with the token periodically
  maxAgeMs: number;
  maxPerUser: number;
}

const DEFAULTS: LiveHubOptions = { heartbeatMs: 25_000, maxAgeMs: 10 * 60_000, maxPerUser: 8 };


/**
 * Server-Sent Events (SSE) fan-out to a user's open tabs/devices.
 * Simple pub sub
 */
export class LiveHub {
  private readonly streams = new Map<string, Set<SseResponse>>();
  constructor(private readonly opts: LiveHubOptions = DEFAULTS) {}

  subscribe(userId: string, res: SseResponse): void {
    res.status(200);
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // tell nginx not to buffer the stream
    });
    res.flushHeaders();
    res.write("retry: 3000\n\n");

    let set = this.streams.get(userId);
    if (!set) this.streams.set(userId, (set = new Set()));
    set.add(res);

    // A forgotten tab must not be able to hold unbounded connections: drop the oldest.
    while (set.size > this.opts.maxPerUser) {
      const oldest = set.values().next().value as SseResponse;
      set.delete(oldest);
      oldest.end();
    }

    res.write(`event: ready\ndata: {}\n\n`);

    const heartbeat = setInterval(() => {
      if (res.writable && !res.writableEnded) res.write(": keep-alive\n\n");
    }, this.opts.heartbeatMs);

    // +/-10% jitter so reconnects after a deploy do not arrive as one herd
    const lifetime = setTimeout(() => res.end(), this.opts.maxAgeMs * (0.9 + Math.random() * 0.2));
    heartbeat.unref();
    lifetime.unref();

    //add listener for when close occurs to clear interval and timeout and remove stream from set
    res.on("close", () => {
      clearInterval(heartbeat);
      clearTimeout(lifetime);
      set.delete(res);
      if (set.size === 0 && this.streams.get(userId) === set) this.streams.delete(userId);
    });
  }

  /**
   * Catch-up for a reconnecting client (Last-Event-ID). Callers subscribe FIRST and replay second,
   * so a notification arriving in between is delivered live instead of falling in a gap; the
   * client dedupes by id.
   */
  replay(res: SseResponse, items: NotificationView[]): void {
    for (const n of items) this.write(res, n);
  }

  /** Returns how many open streams the notification was written to. */
  publish(userId: string, n: NotificationView): number {
    let delivered = 0;
    for (const res of this.streams.get(userId) ?? []) {
      if (this.write(res, n)) delivered++;
    }
    return delivered;
  }

  connectionCount(userId?: string): number {
    if (userId) return this.streams.get(userId)?.size ?? 0;
    let total = 0;
    for (const set of this.streams.values()) total += set.size;
    return total;
  }

  closeAll(): void {
    for (const set of this.streams.values()) for (const res of [...set]) res.end();
  }

  private write(res: SseResponse, n: NotificationView): boolean {
    if (!res.writable || res.writableEnded) return false;
    try {
      // `id` lets the browser send Last-Event-ID on reconnect so nothing is missed
      res.write(`id: ${n.id}\nevent: notification\ndata: ${JSON.stringify(n)}\n\n`);
      return true;
    } catch (error) {
      console.warn("Could not write to a notification stream:", error);
      return false;
    }
  }
}
