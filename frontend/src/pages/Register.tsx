import { Link } from "react-router-dom";

export default function Register() {
  return (
    <main>
      <h1>Register</h1>
      {/* Registration form will go here */}
      <p>
        Already registered? <Link to="/login">Login</Link>
      </p>
    </main>
  );
}