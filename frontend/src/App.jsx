import { useEffect, useState } from "react";
import { Routes, Route, Link, useLocation } from "react-router-dom";
import { Radio, Ticket, History as HistoryIcon, UserCog } from "lucide-react";
import Welcome from "./pages/Welcome";
import Citizen from "./pages/Citizen";
import Staff from "./pages/Staff";
import StaffLogin from "./pages/StaffLogin";
import History from "./pages/History";
import Board from "./pages/Board";

const LINKS = [
  { to: "/citizen", label: "Join a queue", icon: Ticket },
  { to: "/history", label: "My history", icon: HistoryIcon },
  { to: "/staff", label: "Staff", icon: UserCog },
];

export default function App() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <div className="app">
      <div className="gov-stripe" aria-hidden="true" />
      <header className={`topbar ${scrolled ? "topbar-scrolled" : ""}`}>
        <Link to="/" className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Radio size={18} strokeWidth={2.5} />
          </span>
          <span>QueueSmart</span>
        </Link>

        <nav className="nav-desktop">
          {LINKS.map((l) => (
            <Link key={l.to} className={location.pathname.startsWith(l.to) ? "active" : ""} to={l.to}>
              <l.icon size={15} strokeWidth={2.25} aria-hidden="true" />
              {l.label}
            </Link>
          ))}
        </nav>

        <button
          className="nav-toggle"
          aria-label="Toggle navigation menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      </header>

      {menuOpen && (
        <nav className="nav-mobile">
          {LINKS.map((l) => (
            <Link key={l.to} className={location.pathname.startsWith(l.to) ? "active" : ""} to={l.to}>
              <l.icon size={16} strokeWidth={2.25} aria-hidden="true" />
              {l.label}
            </Link>
          ))}
        </nav>
      )}

      <main className="content">
        <div className="page-enter" key={location.pathname}>
          <Routes location={location}>
            <Route path="/" element={<Welcome />} />
            <Route path="/citizen" element={<Citizen />} />
            <Route path="/history" element={<History />} />
            <Route path="/staff/login" element={<StaffLogin />} />
            <Route path="/staff" element={<Staff />} />
            <Route path="/board/:branchId" element={<Board />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
