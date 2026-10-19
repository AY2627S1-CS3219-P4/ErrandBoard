import { useEffect, useState, type MouseEvent } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { useLeaveGuard } from "./leave-guard";
import { getCreditBalance } from "../api/client";
import "./Sidebar.css";

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
    const { shouldBlockLeave } = useLeaveGuard();
    const isAdmin = user?.accountType === "ADMIN" || user?.accountType === "SUPERADMIN";

    useEffect(() => {
        if (!user?.id) return;

        setAvailableCredits(null);
        setCreditsUnavailable(false);
        let active = true;
        getCreditBalance(user.id)
            .then((balance) => {
                if (active) setAvailableCredits(balance.available);
            })
            .catch(() => {
                if (active) setCreditsUnavailable(true);
            });

        return () => { active = false; };
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
                        {availableCredits !== null ? (
                            <span className="sidebar-credits" aria-label={`Available balance: ${availableCredits} credits`}>
                                {availableCredits} credits
                            </span>
                        ) : creditsUnavailable ? (
                            <span className="sidebar-credits sidebar-credits-unavailable" role="status">
                                Credits unavailable
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
