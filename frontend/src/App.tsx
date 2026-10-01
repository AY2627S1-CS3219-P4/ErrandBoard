import { BrowserRouter, Route, Routes } from "react-router-dom";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Homepage from "./pages/Homepage";
import Settings from "./pages/Settings";
import AdminDashboard from "./pages/AdminDashboard";
import AccountAdministration from "./pages/AccountAdministration";
import { AuthProvider } from "./auth/AuthContext";
import { HomeRedirect, RedirectIfAuthenticated, RequireAdmin, RequireAuth, RequireSuperadmin } from "./auth/RouteGuards";


export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<RedirectIfAuthenticated />}>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
          </Route>
          <Route element={<RequireAuth />}>
            <Route path="/home" element={<Homepage />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route element={<RequireAdmin />}>
            <Route path="/admin" element={<AdminDashboard />} />
          </Route>
          <Route element={<RequireSuperadmin />}>
            <Route path="/admin/accounts" element={<AccountAdministration />} />
          </Route>
          <Route path="*" element={<HomeRedirect />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
