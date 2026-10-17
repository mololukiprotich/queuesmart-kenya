import { Link } from "react-router-dom";
import { Ticket, UserCog } from "lucide-react";

/**
 * Landing page — the front door. Its one job is routing the two audiences
 * (citizens, staff) to the flow built for them; it deliberately shows no
 * live data of its own, so it never needs the backend to render.
 */
export default function Welcome() {
  return (
    <div className="welcome">
      <div className="welcome-hero">
        <span className="welcome-eyebrow">Huduma Centre · Digital Queue</span>
        <h1 className="welcome-title">Skip the line.<br />Keep your place.</h1>
        <p className="welcome-sub">
          Join a service queue from your phone, watch your position update live,
          and get called when it's your turn — no need to wait in the hall.
        </p>
      </div>

      <div className="welcome-cards">
        <Link to="/citizen" className="welcome-card welcome-card-primary">
          <span className="welcome-card-icon" aria-hidden="true"><Ticket size={26} strokeWidth={2} /></span>
          <span className="welcome-card-title">I'm a citizen</span>
          <span className="welcome-card-desc">Join a queue or check your ticket and visit history</span>
          <span className="welcome-card-cta">Get started →</span>
        </Link>

        <Link to="/staff" className="welcome-card welcome-card-secondary">
          <span className="welcome-card-icon" aria-hidden="true"><UserCog size={26} strokeWidth={2} /></span>
          <span className="welcome-card-title">Staff &amp; Admin</span>
          <span className="welcome-card-desc">Sign in to run a counter or view branch performance</span>
          <span className="welcome-card-cta">Sign in →</span>
        </Link>
      </div>

      <div className="welcome-footer">
        <span>Huduma Centre GPO, Nairobi</span>
        <span className="dot">·</span>
        <span>A pilot of the QueueSmart Kenya digital queue system</span>
      </div>
    </div>
  );
}
