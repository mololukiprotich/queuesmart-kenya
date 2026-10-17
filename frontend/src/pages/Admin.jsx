import { useEffect, useState } from "react";
import { api } from "../api";
import { formatWait } from "../format";

/**
 * Supervisor dashboard: the "is anything backing up right now" view from
 * the original concept note. Deliberately read-only — a supervisor spots
 * problems here, they don't act on individual tickets (that's the staff
 * console's job), so this page never calls a mutating endpoint.
 *
 * Charts are hand-built inline SVG rather than a charting library: the
 * dataset is tiny (a handful of services, a day of hourly buckets), so a
 * dependency buys nothing. Bars/area use one sequential blue — a single
 * numeric series (queue depth, completions) is a magnitude, not an
 * identity, so one hue carries it; no legend needed for a single series.
 */

const BLUE = "#2a78d6";
const BLUE_SOFT = "rgba(42, 120, 214, 0.16)";
const GRID = "var(--chart-grid)";
const AXIS_TEXT = "var(--chart-muted)";

function StatTile({ label, value, sub, tone }) {
  return (
    <div className="stat-tile" data-tone={tone}>
      <div className="stat-tile-label">{label}</div>
      <div className="stat-tile-value">{value}</div>
      {sub && <div className="stat-tile-sub">{sub}</div>}
    </div>
  );
}

function QueueDepthChart({ services }) {
  const width = 560;
  const height = 200;
  const padding = { top: 16, right: 16, bottom: 32, left: 16 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = Math.max(1, ...services.map((s) => s.waiting_count));
  const barW = innerW / services.length;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart" role="img" aria-label="Current queue depth by service">
      <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke={GRID} strokeWidth="1" />
      {services.map((s, i) => {
        const h = (s.waiting_count / max) * (innerH - 10);
        const x = padding.left + i * barW + barW * 0.2;
        const w = barW * 0.6;
        const y = height - padding.bottom - h;
        return (
          <g key={s.service_id}>
            <title>{`${s.service_name}: ${s.waiting_count} waiting`}</title>
            <rect x={x} y={y} width={w} height={h} rx="4" fill={BLUE} />
            <text x={x + w / 2} y={y - 6} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--chart-text)" fontVariantNumeric="tabular-nums">
              {s.waiting_count}
            </text>
            <text x={x + w / 2} y={height - padding.bottom + 16} textAnchor="middle" fontSize="10.5" fill={AXIS_TEXT}>
              {s.service_name.length > 14 ? s.service_name.slice(0, 13) + "…" : s.service_name}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function CompletionsChart({ points }) {
  const width = 560;
  const height = 200;
  const padding = { top: 16, right: 12, bottom: 28, left: 28 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = Math.max(1, ...points.map((p) => p.completed));
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;

  const coords = points.map((p, i) => ({
    x: padding.left + i * stepX,
    y: padding.top + innerH - (p.completed / max) * innerH,
    ...p,
  }));
  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");
  const areaPath = `${linePath} L ${coords[coords.length - 1]?.x ?? padding.left} ${padding.top + innerH} L ${padding.left} ${padding.top + innerH} Z`;

  const gridLines = [0, 0.5, 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart" role="img" aria-label="Tickets completed per hour">
      {gridLines.map((f) => (
        <line key={f} x1={padding.left} x2={width - padding.right} y1={padding.top + innerH * (1 - f)} y2={padding.top + innerH * (1 - f)} stroke={GRID} strokeWidth="1" />
      ))}
      {coords.length > 1 && <path d={areaPath} fill={BLUE_SOFT} stroke="none" />}
      {coords.length > 1 && <path d={linePath} fill="none" stroke={BLUE} strokeWidth="2" />}
      {coords.map((c, i) => (
        <g key={i}>
          <title>{`${c.label}: ${c.completed} completed`}</title>
          <circle cx={c.x} cy={c.y} r="3.5" fill={BLUE} stroke="var(--surface)" strokeWidth="1.5" />
        </g>
      ))}
      {coords.filter((_, i) => i % Math.ceil(coords.length / 6 || 1) === 0).map((c, i) => (
        <text key={i} x={c.x} y={height - padding.bottom + 16} textAnchor="middle" fontSize="10.5" fill={AXIS_TEXT}>
          {c.label}
        </text>
      ))}
    </svg>
  );
}

export default function Admin({ embedded = false }) {
  const [stats, setStats] = useState(null);
  const [timeseries, setTimeseries] = useState(null);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      const [s, t] = await Promise.all([api.adminStats(), api.adminTimeseries(12)]);
      setStats(s);
      setTimeseries(t);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 8000);
    return () => clearInterval(interval);
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!stats || !timeseries) return <p className="hint">Loading…</p>;

  const noShowPct = Math.round(stats.no_show_rate * 1000) / 10;
  const noShowTone = noShowPct > 15 ? "critical" : noShowPct > 5 ? "warning" : "good";

  return (
    <div className={embedded ? "" : "panel panel-wide"}>
      {!embedded && <span className="eyebrow">Supervisor dashboard</span>}

      <div className="stat-tiles">
        <StatTile label="Served today" value={stats.served_today} />
        <StatTile label="Waiting now" value={stats.waiting_now} />
        <StatTile label="No-show rate" value={`${noShowPct}%`} tone={noShowTone} sub="cumulative" />
      </div>

      <h3 className="section-title">Current queue depth by service</h3>
      <QueueDepthChart services={stats.services} />

      <h3 className="section-title">Tickets completed, last 12 hours</h3>
      <CompletionsChart points={timeseries.points} />

      <h3 className="section-title">Service detail</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Waiting</th>
              <th>Active counters</th>
              <th>Avg service time</th>
              <th>Served today</th>
              <th>No-shows (all time)</th>
            </tr>
          </thead>
          <tbody>
            {stats.services.map((s) => (
              <tr key={s.service_id}>
                <td>{s.service_name}</td>
                <td className="mono">{s.waiting_count}</td>
                <td className="mono">{s.active_counters}</td>
                <td className="mono">{formatWait(s.avg_service_time_seconds)}</td>
                <td className="mono">{s.served_today}</td>
                <td className="mono">{s.no_show_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
