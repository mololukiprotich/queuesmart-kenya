import { useState } from "react";
import { useLocation } from "react-router-dom";
import { api } from "../api";

function formatDate(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_LABEL = {
  waiting: "Waiting",
  called: "Called",
  serving: "Serving",
  done: "Completed",
  no_show: "Missed",
  cancelled: "Cancelled",
};

/**
 * Lets a citizen look up everything they've queued for by phone number.
 * Multi-visit services (e.g. passport renewal) render as a timeline with
 * one row per step, so a citizen with a case still in progress can see
 * exactly which steps are done and which remain — not just a flat ticket
 * list, which would hide that those three tickets are one journey.
 */
export default function History() {
  const location = useLocation();
  const [phone, setPhone] = useState(location.state?.phone || "");
  const [history, setHistory] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function lookup(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api.getHistory(phone);
      setHistory(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="panel panel-wide">
      <span className="eyebrow">Your history</span>
      <form onSubmit={lookup} className="form form-inline">
        <input
          type="tel"
          placeholder="+2547..."
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
        <button type="submit" disabled={loading}>{loading ? "Looking up..." : "Look up"}</button>
      </form>
      {error && <p className="error">{error}</p>}

      {history && (
        <div className="history-results">
          {history.cases.length === 0 && history.single_visit_tickets.length === 0 && (
            <p className="hint">No tickets found for this number yet.</p>
          )}

          {history.cases.map((c) => (
            <div className="case-card" key={c.id}>
              <div className="case-head">
                <span className="case-service">{c.service_name}</span>
                <span className={`badge ${c.status === "completed" ? "badge-done" : "badge-progress"}`}>
                  {c.status === "completed" ? "Completed" : "In progress"}
                </span>
              </div>
              <div className="timeline">
                {c.visit_steps.map((step, i) => {
                  const ticket = c.tickets.find((t) => t.step_index === i);
                  const stepState = i < c.current_step ? "done" : i === c.current_step ? "current" : "upcoming";
                  return (
                    <div className="timeline-row" key={step} data-state={stepState}>
                      <span className="timeline-dot">{stepState === "done" ? "✓" : i + 1}</span>
                      <div className="timeline-body">
                        <div className="timeline-title">{step}</div>
                        {ticket ? (
                          <div className="timeline-meta">
                            {ticket.number} · {STATUS_LABEL[ticket.status]} · {formatDate(ticket.issued_at)}
                          </div>
                        ) : (
                          <div className="timeline-meta muted">Not started yet</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {history.single_visit_tickets.length > 0 && (
            <div className="single-list">
              <div className="stat-label">Other visits</div>
              {history.single_visit_tickets.map((t) => (
                <div className="single-row" key={t.id}>
                  <span>{t.service_name}</span>
                  <span className="mono">{t.number}</span>
                  <span className={`badge ${t.status === "done" ? "badge-done" : "badge-progress"}`}>
                    {STATUS_LABEL[t.status]}
                  </span>
                  <span className="hint">{formatDate(t.issued_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
