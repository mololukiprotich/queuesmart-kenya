// A realistic hourglass, not a geometric diagram: curved glass bulbs (not
// straight cone walls), a glass highlight streak, grainy sand via SVG
// turbulence, a brass-toned frame, and a grounding drop shadow. Same
// trapezoid/triangle fill math as the previous version (verified
// correct — see git history) — only the silhouette and surface finish
// changed, not the underlying geometry logic for where the sand sits.

const W = 100;
const H = 150;
const NECK_Y = 75;
const TOP_Y = 20;
const BOTTOM_Y = 130;
const BULB_HALF_WIDTH = 34;

// Each bulb is one closed path: a straight rim at the wide end, bulging
// out along a cubic bezier, meeting at the neck point — real blown-glass
// curvature instead of a straight-edged cone.
function topBulbPath() {
  return (
    `M18,${TOP_Y} L82,${TOP_Y} ` +
    `C82,${TOP_Y + 22} 70,${NECK_Y - 14} 50,${NECK_Y} ` +
    `C30,${NECK_Y - 14} 18,${TOP_Y + 22} 18,${TOP_Y} Z`
  );
}
function bottomBulbPath() {
  return (
    `M18,${BOTTOM_Y} L82,${BOTTOM_Y} ` +
    `C82,${BOTTOM_Y - 22} 70,${NECK_Y + 14} 50,${NECK_Y} ` +
    `C30,${NECK_Y + 14} 18,${BOTTOM_Y - 22} 18,${BOTTOM_Y} Z`
  );
}

// Width of the bulb interior at height y, easing with a sine curve rather
// than linearly — hugs the bezier curvature above so the sand's edges
// visually follow the curved glass wall instead of cutting across it.
function bulbHalfWidthAt(y, nearY, farY) {
  const t = Math.max(0, Math.min(1, Math.abs(y - nearY) / Math.abs(farY - nearY)));
  return BULB_HALF_WIDTH * Math.sin((t * Math.PI) / 2);
}

export default function Hourglass({ progress = 0, size = 88 }) {
  const p = Math.max(0, Math.min(1, progress));

  const topSurfaceY = TOP_Y + p * (NECK_Y - TOP_Y);
  const topHalfWidth = bulbHalfWidthAt(topSurfaceY, NECK_Y, TOP_Y);
  const topSandPoints = `${50 - topHalfWidth},${topSurfaceY} ${50 + topHalfWidth},${topSurfaceY} 50,${NECK_Y}`;

  const pileTopY = BOTTOM_Y - p * (BOTTOM_Y - NECK_Y);
  const pileHalfWidth = bulbHalfWidthAt(pileTopY, NECK_Y, BOTTOM_Y);
  const floorHalfWidth = bulbHalfWidthAt(BOTTOM_Y, NECK_Y, BOTTOM_Y); // == BULB_HALF_WIDTH, kept symbolic for clarity
  const bottomSandPoints =
    `${50 - floorHalfWidth},${BOTTOM_Y} ${50 + floorHalfWidth},${BOTTOM_Y} ` +
    `${50 + pileHalfWidth},${pileTopY} ${50 - pileHalfWidth},${pileTopY}`;

  const draining = p < 0.98;

  return (
    <svg
      className="hourglass"
      width={size}
      height={(size * H) / W}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Waiting — about ${Math.round(p * 100)}% of the way through`}
    >
      <defs>
        <linearGradient id="hg-sand" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffd372" />
          <stop offset="55%" stopColor="#f2a93c" />
          <stop offset="100%" stopColor="#c4730f" />
        </linearGradient>
        <linearGradient id="hg-glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.32" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0.03" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.10" />
        </linearGradient>
        <linearGradient id="hg-frame" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3a2a1a" />
          <stop offset="50%" stopColor="#1f160d" />
          <stop offset="100%" stopColor="#0b0b0b" />
        </linearGradient>
        <filter id="hg-grain" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="noise" />
          <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.35 0" />
          <feComposite operator="in" in2="SourceGraphic" />
        </filter>
        <filter id="hg-shadow" x="-30%" y="-10%" width="160%" height="130%">
          <feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#000000" floodOpacity="0.18" />
        </filter>
      </defs>

      <g filter="url(#hg-shadow)">
        {/* brass frame caps */}
        <rect x="8" y="10" width="84" height="9" rx="4.5" fill="url(#hg-frame)" />
        <rect x="8" y="131" width="84" height="9" rx="4.5" fill="url(#hg-frame)" />
        <rect x="12" y="17" width="76" height="2" fill="#5a4326" opacity="0.6" />
        <rect x="14" y="137" width="72" height="2.5" rx="1.25" fill="var(--accent)" />

        {/* glass interior tint — each bulb is its own proper closed shape */}
        <path d={topBulbPath()} fill="url(#hg-glass)" />
        <path d={bottomBulbPath()} fill="url(#hg-glass)" />

        {/* sand, with grain */}
        <polygon points={topSandPoints} fill="url(#hg-sand)" />
        <polygon points={topSandPoints} fill="#000" filter="url(#hg-grain)" opacity="0.5" />
        <polygon points={bottomSandPoints} fill="url(#hg-sand)" />
        <polygon points={bottomSandPoints} fill="#000" filter="url(#hg-grain)" opacity="0.5" />

        {/* curved glass outline, drawn over the sand so it reads as a
            vessel holding the sand rather than a line sitting behind it */}
        <path d={topBulbPath()} fill="none" stroke="var(--border)" strokeWidth="2" strokeLinejoin="round" />
        <path d={bottomBulbPath()} fill="none" stroke="var(--border)" strokeWidth="2" strokeLinejoin="round" />

        {/* glass highlight streak — the detail that sells "glass" over
            "flat shape" */}
        <path
          d={`M28,${TOP_Y + 10} C26,${NECK_Y - 20} 34,${NECK_Y - 8} 40,${NECK_Y - 4}`}
          fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.45"
        />
        <path
          d={`M28,${BOTTOM_Y - 10} C26,${NECK_Y + 20} 34,${NECK_Y + 8} 40,${NECK_Y + 4}`}
          fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" opacity="0.3"
        />

        {draining && (
          // Thin glowing line + brighter dots — plain 1px circles were
          // checked in an actual browser render and were essentially
          // invisible at the size this renders at in the UI.
          <g className="hourglass-stream">
            <line x1="50" y1={NECK_Y - 6} x2="50" y2={NECK_Y + 6} stroke="#ffe3a3" strokeWidth="1.4" opacity="0.5" />
            <circle cx="50" cy={NECK_Y - 3} r="2.4" fill="#ffe3a3" />
            <circle cx="50" cy={NECK_Y + 1} r="2" fill="#ffd372" />
            <circle cx="50" cy={NECK_Y + 5} r="2.4" fill="#ffe3a3" />
          </g>
        )}
      </g>
    </svg>
  );
}
