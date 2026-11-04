import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { useCreditBalance } from "../hooks/useCreditBalance";
import "./Settings.css";
import "./Homepage.css";

export default function Homepage() {
    const { user } = useAuth();
    const { available, reserved, ready, unavailable } = useCreditBalance(user?.id);

    const showUnavailable = unavailable;
    const showBalance = ready && !unavailable && available !== null && reserved !== null;

    return (
        <main className="settings-shell">
            <header className="app-page-header">
                <span />
                <h1>ErrandBoard Homepage</h1>
                <span />
            </header>
            <div className="homepage-content">
                <section className="home-card home-credits" aria-labelledby="home-credits-heading">
                    <h2 id="home-credits-heading" className="home-card-title">Your credits</h2>
                    {showUnavailable ? (
                        <p className="home-credits-unavailable" role="status">
                            Credits are temporarily unavailable. Please try again shortly.
                        </p>
                    ) : showBalance ? (
                        <div className="home-credits-grid">
                            <div className="home-credit-stat">
                                <span className="home-credit-value">{available}</span>
                                <span className="home-credit-label">Available</span>
                            </div>
                            <div className="home-credit-stat">
                                <span className="home-credit-value">{reserved}</span>
                                <span className="home-credit-label">Reserved</span>
                            </div>
                        </div>
                    ) : (
                        <p className="home-credits-loading" role="status">Loading credits…</p>
                    )}
                </section>

                <section className="home-actions" aria-label="Quick actions">
                    <Link to="/suppliers" className="home-card home-action-card">
                        <span className="home-action-title">View suppliers</span>
                        <span className="home-action-desc">Browse suppliers and request an errand.</span>
                    </Link>
                    <Link to="/errands" className="home-card home-action-card">
                        <span className="home-action-title">Accept an errand</span>
                        <span className="home-action-desc">Find open errands you can take on.</span>
                    </Link>
                </section>
            </div>
        </main>
    );
}
