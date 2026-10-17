import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api";
import { getSession, clearSession, isAdmin } from "../auth";
import Admin from "./Admin";

/**
 * Staff console: select a counter, see its live waiting list, and act on
 * one ticket at a time. Deliberately large touch targets and a single
 * primary action (Call Next) — this is used standing up, glanced at
 * between citizens, not read closely like a dashboard.
 */
function Console() {
  const [counters, setCounters] = useState([]);
  const [counterId, setCounterId] = useState("");
  const [queue, setQueue] = useState([]);
  const [current, setCurrent] = useState(null); // the ticket just called, awaiting complete/no-show
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.listCounters().then(setCounters).catch((e) => setError(e.message));
  }, []);

  async function refreshQueue(id) {
    if (!id) return;
    const q = await api.counterQueue(id);
    setQueue(q);
  }

  useEffect(() => {
    refreshQueue(counterId);
    const interval = setInterval(() => refreshQueue(counterId), 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counterId]);

  async function handleCallNext() {
    setError("");
    try {
      const res = await api.callNext(counterId);
      setMessage(res.message);
      setCurrent(res.ticket);
      refreshQueue(counterId);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleComplete() {
    try {
      await api.completeTicket(current.id);
      setCurrent(null);
      setMessage("Marked done.");
      refreshQueue(counterId);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleNoShow() {
    try {
      await api.noShow(current.id);
      setCurrent(null);
      setMessage("Marked no-show — requeued.");
      refreshQueue(counterId);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
      <label className="counter-select">
        Counter
        <select value={counterId} onChange={(e) => { setCounterId(e.target.value); setCurrent(null); }}>
          <option value="" disabled>Select your counter</option>
          {counters.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      </label>

      {counterId && (
        <>
          <div className="current-ticket">
            {current ? (
              <>
                <div className="stat-label">Now serving</div>
                <div className="ticket-number">{current.number}</div>
                <div className="action-row">
                  <button className="primary" onClick={handleComplete}>Done</button>
                  <button className="secondary" onClick={handleNoShow}>No-show</button>
                </div>
              </>
            ) : (
              <button className="primary call-next" onClick={handleCallNext}>Call Next</button>
            )}
          </div>

          {message && <p className="hint">{message}</p>}
          {error && <p className="error">{error}</p>}

          <div className="queue-list">
            <div className="stat-label">Waiting ({queue.length})</div>
            <ol>
              {queue.map((t) => (
                <li key={t.id}>{t.number}</li>
              ))}
            </ol>
          </div>
        </>
      )}
    </>
  );
}

/**
 * The gate: no account, no console. Admin is not a separate route — it's a
 * tab inside this already-authenticated page, only rendered for a
 * supervisor/admin account, matching the backend's own role check on
 * /api/admin/* (see auth.py require_admin). Hiding the tab for an agent
 * is a UX nicety; the real boundary is enforced server-side either way.
 */
export default function Staff() {
  const [session, setLocalSession] = useState(getSession());
  const [tab, setTab] = useState("console");

  if (!session) {
    return <Navigate to="/staff/login" replace />;
  }

  function logout() {
    clearSession();
    setLocalSession(null);
  }

  const admin = isAdmin(session.staff);

  return (
    <div className={tab === "admin" ? "panel panel-wide" : "panel"}>
      <div className="staff-bar">
        <div>
          <span className="eyebrow">Staff</span>
          <div className="staff-name">{session.staff.name || session.staff.username}</div>
          <div className="staff-role">{session.staff.role}</div>
        </div>
        <button className="secondary logout-btn" onClick={logout}>Sign out</button>
      </div>

      {admin && (
        <div className="tab-row">
          <button className={tab === "console" ? "tab active" : "tab"} onClick={() => setTab("console")}>Console</button>
          <button className={tab === "admin" ? "tab active" : "tab"} onClick={() => setTab("admin")}>Admin</button>
        </div>
      )}

      {tab === "console" || !admin ? <Console /> : <Admin embedded />}
    </div>
  );
}
