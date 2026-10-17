import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { setSession } from "../auth";

export default function StaffLogin({ onLoggedIn }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api.staffLogin(username, password);
      setSession(res.token, res.staff);
      onLoggedIn?.(res.staff);
      navigate("/staff", { replace: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel">
      <span className="eyebrow">Staff sign in</span>
      <form onSubmit={submit} className="form">
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button type="submit" disabled={loading}>{loading ? "Signing in..." : "Sign in"}</button>
      </form>
      {error && <p className="error">{error}</p>}
      <p className="hint demo-hint">
        Demo accounts — agent: <code>agent1</code> / <code>agent123</code> · supervisor: <code>supervisor1</code> / <code>super123</code>
      </p>
    </div>
  );
}
