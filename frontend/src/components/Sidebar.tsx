import { useEffect, useState, type MouseEvent } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { useLeaveGuard } from "./leave-guard";
import {
    CREDIT_BALANCE_REFRESH_EVENT,
    creditApiUrl,
    getCreditBalance,
} from "../api/client";
import "./Sidebar.css";

const CREDIT_BALANCE_EVENT = "credit-balance-updated";
const EVENT_RECONNECT_DELAY_MS = 5_000;

const linkClass = (isActive: boolean) =>
    isActive ? "sidebar-link sidebar-link-active" : "sidebar-link";

export default function Sidebar() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [logoutError, setLogoutError] = useState("");
    const [availableCredits, setAvailableCredits] = useState<number | null>(null);
    const [creditsUnavailable, setCreditsUnavailable] = useState(false);
    const [balanceUserId, setBalanceUserId] = useState<string | null>(null);
    const { shouldBlockLeave } = useLeaveGuard();
    const isAdmin = user?.accountType === "ADMIN" || user?.accountType === "SUPERADMIN";

    useEffect(() => {
        if (!user?.id) return;

        let active = true;
        let eventSource: EventSource | undefined;
        let reconnectTimer: number | undefined;
        let reconnecting = false;

        const refreshBalance = async () => {
            try {
                const balance = await getCreditBalance(user.id);
                if (active) {
                    setBalanceUserId(user.id);
                    setAvailableCredits(balance.available);
                    setCreditsUnavailable(false);
                }
            } catch {
                if (active) {
                    setBalanceUserId(user.id);
                    setCreditsUnavailable(true);
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
    }, [user?.id]);

    function handleNavigate(event: MouseEvent<HTMLAnchorElement>) {
        if (shouldBlockLeave()) event.preventDefault();
    }

    async function handleLogout() {
        if (shouldBlockLeave()) return;
        setIsLoggingOut(true);
        setLogoutError("");
        try {
            await logout();
            navigate("/login", { replace: true });
        } catch {
            setLogoutError("Could not log out. Please try again.");
        } finally {
            setIsLoggingOut(false);
        }
    }

    return (
        <nav className="sidebar" aria-label="Main navigation">
            <p className="sidebar-brand">ErrandBoard</p>
            <ul className="sidebar-list">
                <li>
                    <NavLink className={({ isActive }) => linkClass(isActive)} to="/home" onClick={handleNavigate}>
                        Home
                    </NavLink>
                </li>
                <li>
                    <NavLink
                        className={({ isActive }) => linkClass(isActive || pathname.startsWith("/supplier/"))}
                        to="/suppliers"
                        onClick={handleNavigate}
                    >
                        Suppliers
                    </NavLink>
                </li>
                <li>
                    <NavLink className={({ isActive }) => linkClass(isActive)} to="/errands" end onClick={handleNavigate}>
                        Errands
                    </NavLink>
                </li>
                <li>
                    <NavLink className={({ isActive }) => linkClass(isActive)} to="/errands/active" end onClick={handleNavigate}>
                        My Errands
                    </NavLink>
                </li>
                {isAdmin && (
                    <li>
                        <NavLink className={({ isActive }) => linkClass(isActive)} to="/admin" onClick={handleNavigate}>
                            Admin Dashboard
                        </NavLink>
                    </li>
                )}
                <li>
                    <NavLink className={({ isActive }) => linkClass(isActive)} to="/settings" onClick={handleNavigate}>
                        Settings
                    </NavLink>
                </li>
            </ul>
            {/* Desktop only */}
            <div className="sidebar-account">
                <div className="sidebar-user">
                    <div className="sidebar-user-line">
                        <span className="sidebar-username">{user?.username}</span>
                        {balanceUserId === user?.id && creditsUnavailable ? (
                            <span className="sidebar-credits sidebar-credits-unavailable" role="status">
                                Credits temporarily unavailable
                            </span>
                        ) : balanceUserId === user?.id && availableCredits !== null ? (
                            <span className="sidebar-credits" aria-label={`Available balance: ${availableCredits} credits`}>
                                {availableCredits} credits
                            </span>
                        ) : (
                            <span className="sidebar-credits" role="status">Loading credits…</span>
                        )}
                    </div>
                </div>
                {logoutError && <p className="sidebar-error" role="alert">{logoutError}</p>}
                <button className="sidebar-logout-button" type="button" onClick={handleLogout} disabled={isLoggingOut}>
                    {isLoggingOut ? "Logging out…" : "Log out"}
                </button>
            </div>
        </nav>
    );
}
