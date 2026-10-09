import { useMemo, useRef } from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
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
            <div className="app-with-sidebar">
                <Sidebar />
                <div className="app-content">
                    <Outlet />
                </div>
            </div>
        </LeaveGuardContext.Provider>
    );
}
