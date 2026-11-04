import { useEffect, useState } from "react";
import {
  CREDIT_BALANCE_REFRESH_EVENT,
  creditApiUrl,
  getCreditBalance,
} from "../api/client";

const CREDIT_BALANCE_EVENT = "credit-balance-updated";
const EVENT_RECONNECT_DELAY_MS = 5_000;

export type CreditBalanceState = {
  available: number | null;
  reserved: number | null;
  /** True once a balance load has resolved (success or failure) for the current user. */
  ready: boolean;
  /** True when the balance could not be loaded for the current user. */
  unavailable: boolean;
};

/**
 * Subscribes to the signed-in user's credit balance: an initial fetch, live
 * server-sent updates, and a reconnecting event stream. Shared by the sidebar
 * and the homepage so the reconnect logic lives in one place.
 */
export function useCreditBalance(userId: string | undefined): CreditBalanceState {
  const [available, setAvailable] = useState<number | null>(null);
  const [reserved, setReserved] = useState<number | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [balanceUserId, setBalanceUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;

    let active = true;
    let eventSource: EventSource | undefined;
    let reconnectTimer: number | undefined;
    let reconnecting = false;

    const refreshBalance = async () => {
      try {
        const balance = await getCreditBalance(userId);
        if (active) {
          setBalanceUserId(userId);
          setAvailable(balance.available);
          setReserved(balance.reserve);
          setUnavailable(false);
        }
      } catch {
        if (active) {
          setBalanceUserId(userId);
          setUnavailable(true);
        }
      }
    };

    const connectToBalanceEvents = () => {
      if (!active) return;
      eventSource = new EventSource(creditApiUrl("/credit/me/events"), { withCredentials: true });
      eventSource.addEventListener(CREDIT_BALANCE_EVENT, () => {
        void refreshBalance();
      });
      eventSource.onerror = () => {
        eventSource?.close();
        eventSource = undefined;
        if (reconnecting) return;
        reconnecting = true;

        // A balance request also refreshes an expired access cookie
        // through apiFetch before the event stream is reopened.
        void refreshBalance().finally(() => {
          if (active) {
            reconnectTimer = window.setTimeout(() => {
              reconnectTimer = undefined;
              reconnecting = false;
              connectToBalanceEvents();
            }, EVENT_RECONNECT_DELAY_MS);
          }
        });
      };
    };

    const handleLocalBalanceRefresh = () => {
      void refreshBalance();
    };

    void refreshBalance();
    connectToBalanceEvents();
    window.addEventListener(CREDIT_BALANCE_REFRESH_EVENT, handleLocalBalanceRefresh);

    return () => {
      active = false;
      window.removeEventListener(CREDIT_BALANCE_REFRESH_EVENT, handleLocalBalanceRefresh);
      eventSource?.close();
      reconnecting = false;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    };
  }, [userId]);

  const ready = balanceUserId === userId;

  return {
    available: ready ? available : null,
    reserved: ready ? reserved : null,
    ready,
    unavailable: ready && unavailable,
  };
}
