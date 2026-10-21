import { useEffect, useState } from "react";
import { Armchair, Users } from "lucide-react";
import { api } from "../api";
import { formatWait } from "../format";

const POLL_MS = 20_000;

/**
 * Per-counter queue lengths + estimated wait for a branch — read-only,
 * no login. Polled rather than WebSocket-driven on purpose: a live ticket
 * view subscribes to exactly one service's room (see Citizen.jsx), but
 * this spans every counter/service at a branch at once, so one room per
 * counter would mean opening N sockets for a view that doesn't need
 * sub-second freshness — a 20s poll is plenty for "how busy is it right
 * now" and keeps this component simple enough to drop into both the
 * citizen flow and a standalone signage screen (see Board.jsx).
 */
export default function QueueOverview({ branchId }) {
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!branchId) return;
    let cancelled = false;

    function load() {
      api.getQueueOverview(branchId)
        .then((data) => { if (!cancelled) setOverview(data); })
        .catch((e) => { if (!cancelled) setError(e.message); });
    }

    load();
    const interval = setInterval(load, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [branchId]);

  if (error) return <p className="error">{error}</p>;
  if (!overview) return <div className="queue-overview-skeleton" aria-hidden="true" />;

  return (
    <div className="queue-overview">
      <div className="queue-overview-head">
        <span className="queue-overview-total">
          <Users size={14} strokeWidth={2.25} aria-hidden="true" />
          {overview.total_waiting} waiting branch-wide
        </span>
        <span className="queue-overview-longest">Longest line: {formatWait(overview.longest_wait_seconds)}</span>
      </div>
      <div className="queue-overview-grid">
        {overview.counters.map((c) => (
          <div className="counter-card" key={c.counter_id}>
            <div className="counter-card-head">
              <Armchair size={16} strokeWidth={2.25} aria-hidden="true" />
              <span className="counter-card-label">{c.label}</span>
            </div>
            <div className="counter-card-services">{c.service_names.join(", ") || "Unassigned"}</div>
            <div className="counter-card-stats">
              <span className="counter-card-count">{c.waiting_count} waiting</span>
              <span className="counter-card-wait">{formatWait(c.estimated_wait_seconds)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
