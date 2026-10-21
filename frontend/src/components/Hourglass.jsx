// A proper hourglass, not a generic spinner — sand level is computed from
// real geometry (the sand surface follows the cone's taper), not a crude
// rectangle, so it actually reads as sand rather than a filling box.
// `progress` is 0 (just joined, full top chamber) to 1 (about to be
// called, fully drained). Pure SVG + CSS keyframes, no animation library,
// matching the rest of the app's waiting-animation approach.

const VIEWBOX_W = 100;
const VIEWBOX_H = 140;
const NECK_Y = 70;
const TOP_Y = 16;
const BOTTOM_Y = 124;
const CONE_HALF_WIDTH = 36;

function taperHalfWidth(y, fromY, toY) {
  // Half-width at height y within a cone tapering linearly to a point.
  const t = Math.max(0, Math.min(1, (toY - y) / (toY - fromY)));
  return CONE_HALF_WIDTH * t;
}

export default function Hourglass({ progress = 0, size = 72 }) {
  const p = Math.max(0, Math.min(1, progress));

  // Top chamber: sand surface drops from TOP_Y toward NECK_Y as p -> 1.
  const surfaceY = TOP_Y + p * (NECK_Y - TOP_Y);
  const surfaceHalfWidth = taperHalfWidth(surfaceY, TOP_Y, NECK_Y);
  const topSandPoints = `${50 - surfaceHalfWidth},${surfaceY} ${50 + surfaceHalfWidth},${surfaceY} 50,${NECK_Y}`;

  // Bottom chamber: sand filling the cone from the floor upward, like
  // liquid poured into a funnel — a trapezoid (full cone width at the
  // floor, tapering to the current fill height), NOT a triangle like the
  // top chamber. The top chamber's remaining sand is correctly a triangle
  // because its lower bound is the neck *point*; the pile's lower bound
  // is the flat *floor*, so its cross-section only becomes a triangle in
  // the limit as the fill height reaches the neck (p -> 1), at which
  // point pileHalfWidth below naturally goes to 0 and these two points
  // merge into one, giving a full triangle exactly filling the chamber.
  const pileTopY = BOTTOM_Y - p * (BOTTOM_Y - NECK_Y);
  const pileHalfWidth = taperHalfWidth(pileTopY, BOTTOM_Y, NECK_Y);
  const bottomSandPoints =
    `${50 - CONE_HALF_WIDTH},${BOTTOM_Y} ${50 + CONE_HALF_WIDTH},${BOTTOM_Y} ` +
    `${50 + pileHalfWidth},${pileTopY} ${50 - pileHalfWidth},${pileTopY}`;

  const draining = p < 0.98;

  return (
    <svg
      className="hourglass"
      width={size}
      height={(size * VIEWBOX_H) / VIEWBOX_W}
      viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
      role="img"
      aria-label={`Waiting — about ${Math.round(p * 100)}% of the way through`}
    >
      <defs>
        <linearGradient id="hg-sand" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f6b93b" />
          <stop offset="100%" stopColor="#d4820f" />
        </linearGradient>
      </defs>

      {/* frame: caps in Kenyan black, a thin green accent base */}
      <rect x="6" y="8" width="88" height="8" rx="4" fill="#0b0b0b" />
      <rect x="6" y="124" width="88" height="8" rx="4" fill="#0b0b0b" />
      <rect x="10" y="130" width="80" height="3" rx="1.5" fill="var(--accent)" />

      {/* glass silhouette */}
      <path
        d={`M14,16 L86,16 L50,${NECK_Y} L86,124 L14,124 L50,${NECK_Y} Z`}
        fill="none"
        stroke="var(--border)"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* sand */}
      <polygon points={topSandPoints} fill="url(#hg-sand)" className="hourglass-sand-top" />
      <polygon points={bottomSandPoints} fill="url(#hg-sand)" className="hourglass-sand-bottom" />

      {/* falling stream */}
      {draining && (
        <g className="hourglass-stream">
          <circle cx="50" cy="68" r="1.6" fill="#f6b93b" />
          <circle cx="50" cy="72" r="1.6" fill="#f6b93b" />
          <circle cx="50" cy="76" r="1.6" fill="#f6b93b" />
        </g>
      )}
    </svg>
  );
}
