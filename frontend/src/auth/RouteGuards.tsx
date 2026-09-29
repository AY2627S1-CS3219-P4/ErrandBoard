import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./useAuth";

export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "checking") {
    return <main className="auth-page" role="status">Checking your session…</main>;
  }
  if (status === "unauthenticated") {
    return <Navigate to="/login" replace state={{
      message: "Access denied. Please log in to view this page.",
      from: location.pathname,
    }} />;
  }
  return <Outlet />;
}

export function RedirectIfAuthenticated() {
  const { status } = useAuth();
  if (status === "checking") {
    return <main className="auth-page" role="status">Checking your session…</main>;
  }
  return status === "authenticated" ? <Navigate to="/home" replace /> : <Outlet />;
}

export function HomeRedirect() {
  const { status } = useAuth();
  if (status === "checking") {
    return <main className="auth-page" role="status">Checking your session…</main>;
  }
  return <Navigate to={status === "authenticated" ? "/home" : "/login"} replace />;
}
