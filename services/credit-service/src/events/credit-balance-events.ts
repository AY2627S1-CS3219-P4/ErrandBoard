import type { Response } from "express";

const clientsByUser = new Map<string, Set<Response>>();
const EVENT_NAME = "credit-balance-updated";

function sendBalanceUpdate(response: Response): void {
  if (!response.writableEnded && response.writable) {
    response.write(`event: ${EVENT_NAME}\ndata: {}\n\n`);
  }
}

/** Open an authenticated Server-Sent Events stream for one user's balance changes. */
export function subscribeToCreditBalance(userId: string, response: Response): void {
  response.status(200);
  response.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  response.flushHeaders();
  response.write("retry: 5000\n\n");

  let clients = clientsByUser.get(userId);
  if (!clients) {
    clients = new Set<Response>();
    clientsByUser.set(userId, clients);
  }
  clients.add(response);

  // Send a fresh signal on connect/reconnect so the browser catches up if it
  // was offline when a balance changed.
  sendBalanceUpdate(response);

  const heartbeat = setInterval(() => {
    if (response.writable && !response.writableEnded) response.write(": keep-alive\n\n");
  }, 25_000);
  heartbeat.unref();

  response.on("close", () => {
    clearInterval(heartbeat);
    clients?.delete(response);
    if (clients?.size === 0) clientsByUser.delete(userId);
  });
}

/** Notify every open browser stream belonging to each affected account. */
export function notifyCreditBalanceUpdated(userIds: string[]): void {
  for (const userId of new Set(userIds)) {
    for (const response of clientsByUser.get(userId) ?? []) {
      try {
        sendBalanceUpdate(response);
      } catch (error) {
        console.warn("Could not notify a Credit balance listener:", error);
      }
    }
  }
}
