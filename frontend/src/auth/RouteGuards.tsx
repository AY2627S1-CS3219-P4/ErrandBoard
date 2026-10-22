import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./useAuth";

function AuthenticationUnavailable() {
  const { refreshAuth } = useAuth();
  return <main className="auth-page" role="alert">
    <h1>Authentication is temporarily unavailable</h1>
    <p>We could not check your session. Your account has not been logged out.</p>
    <button type="button" onClick={() => void refreshAuth()}>Try again</button>
  </main>;
}

export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "checking") {
    return <main className="auth-page" role="status">Checking your session…</main>;
  }
  if (status === "unavailable") return <AuthenticationUnavailable />;
  if (status === "unauthenticated") {
    return <Navigate to="/login" replace state={{
      message: "Access denied. Please log in to view this page.",
      from: location.pathname,
    }} />;
  }
  return <Outlet />;
}

export function RequireAdmin() {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === "checking") {
    return <main className="auth-page" role="status">Checking your permissions…</main>;
  }
  if (status === "unavailable") return <AuthenticationUnavailable />;

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace state={{
      message: "Access denied. Please log in to view this page.",
      from: location.pathname,
    }} />;
  }

  const isAdmin = user?.accountType === "ADMIN" || user?.accountType === "SUPERADMIN";
  if (!isAdmin) {
    return <Navigate to="/home" replace state={{
      message: "You are not authorised to access the admin dashboard.",
    }} />;
  }

  return <Outlet />;
}

export function RequireSuperadmin() {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === "checking") {
    return <main className="auth-page" role="status">Checking your permissions…</main>;
  }
  if (status === "unavailable") return <AuthenticationUnavailable />;

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace state={{
      message: "Access denied. Please log in to view this page.",
      from: location.pathname,
    }} />;
  }

  if (user?.accountType !== "SUPERADMIN") {
    return <Navigate to="/admin" replace state={{
      message: "Only Superadmins can access account administration.",
    }} />;
  }

  return <Outlet />;
}

export function RedirectIfAuthenticated() {
  const { status } = useAuth();
  if (status === "checking") {
    return <main className="auth-page" role="status">Checking your session…</main>;
  }
  if (status === "unavailable") return <AuthenticationUnavailable />;
  return status === "authenticated" ? <Navigate to="/home" replace /> : <Outlet />;
}

export function HomeRedirect() {
  const { status } = useAuth();
  if (status === "checking") {
    return <main className="auth-page" role="status">Checking your session…</main>;
  }
  if (status === "unavailable") return <AuthenticationUnavailable />;
  return <Navigate to={status === "authenticated" ? "/home" : "/login"} replace />;
}
