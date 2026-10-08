import { createContext, useContext } from "react";

// Returns true when the current page wants to block navigating away.
export type LeaveGuard = () => boolean;

type LeaveGuardContextValue = {
  setLeaveGuard: (guard: LeaveGuard | null) => void;
  shouldBlockLeave: () => boolean;
};

export const LeaveGuardContext = createContext<LeaveGuardContextValue>({
  setLeaveGuard: () => {},
  shouldBlockLeave: () => false,
});

export function useLeaveGuard() {
  return useContext(LeaveGuardContext);
}
