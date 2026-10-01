import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";

export default function Homepage() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const [logoutError, setLogoutError] = useState("");
    const isAdmin = user?.accountType === "ADMIN" || user?.accountType === "SUPERADMIN";

    async function handleLogout() {
        setIsLoggingOut(true);
        setLogoutError("");

        try {
            await logout();
            navigate("/login", { replace: true });
        } catch {
            setLogoutError("We could not complete logout. Please try again.");
        } finally {
            setIsLoggingOut(false);
        }
    }

    return (
        <main>
            <h1>ErrandBoard Homepage</h1>
            <p>Still a WIP!</p>
            <button type="button" onClick={handleLogout} disabled={isLoggingOut}>
                {isLoggingOut ? "Logging out..." : "Log out"}
            </button>
            {logoutError && <p role="alert">{logoutError}</p>}
            {isAdmin && (
                <Link className="admin-dashboard-link" to="/admin">
                    Open Admin Dashboard
                </Link>
            )}
        </main>
    )
}
