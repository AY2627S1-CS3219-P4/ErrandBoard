import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import Login from "./pages/Login"
import Register from "./pages/Register";
import Homepage from "./pages/Homepage";



export default function App() {
  return (
    <BrowserRouter>
      <nav>
        <Link to="/login">Login</Link>{" "}
        <Link to="/register">Register</Link>
      </nav>

      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/home" element={<Homepage />} />
      </Routes>
    </BrowserRouter>
  );
}
