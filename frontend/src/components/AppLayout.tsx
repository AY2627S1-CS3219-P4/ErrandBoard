import { useMemo, useRef } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import NotificationToasts from "../notifications/NotificationToasts";
import { NotificationProvider } from "../notifications/NotificationProvider";
import { LeaveGuardContext, type LeaveGuard } from "./leave-guard";
import "./Sidebar.css";

export default function AppLayout() {
    const guardRef = useRef<LeaveGuard | null>(null);
    const leaveGuard = useMemo(() => ({
        setLeaveGuard: (guard: LeaveGuard | null) => { guardRef.current = guard; },
        shouldBlockLeave: () => guardRef.current?.() ?? false,
    }), []);

    return (
        <LeaveGuardContext.Provider value={leaveGuard}>
            <NotificationProvider>
                <div className="app-with-sidebar">
                    <Sidebar />
                    <div className="app-content">
                        <Outlet />
                    </div>
                </div>
                <NotificationToasts />
            </NotificationProvider>
        </LeaveGuardContext.Provider>
    );
}
