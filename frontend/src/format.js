export function formatWait(seconds) {
  if (seconds <= 0) return "now";
  const mins = Math.round(seconds / 60);
  if (mins < 1) return "under a minute";
  if (mins === 1) return "about 1 minute";
  if (mins < 60) return `about ${mins} minutes`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `about ${hrs}h ${rem}m`;
}
