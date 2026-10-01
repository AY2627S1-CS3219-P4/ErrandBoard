import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import "./Settings.css";

export default function Homepage() {
    const { user } = useAuth();
    const isAdmin = user?.accountType === "ADMIN" || user?.accountType === "SUPERADMIN";

    return (
        <main className="settings-shell">
            <header className="app-page-header">
                <span />
                <h1>ErrandBoard Homepage</h1>
                <Link className="settings-link" to="/settings" aria-label="Open settings">
                    Settings
                </Link>
            </header>
            <div className="homepage-content">
            <p>Still a WIP!</p>
            {isAdmin && (
                <Link className="admin-dashboard-link" to="/admin">
                    Open Admin Dashboard
                </Link>
            )}
            </div>
        </main>
    )
}
