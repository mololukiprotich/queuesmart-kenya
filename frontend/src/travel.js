// Phase 1 of the "time to head to the centre" idea (see improvemnt.md 4.1):
// a free, no-API-key straight-line distance / assumed-speed estimate,
// entirely client-side. Location is never sent to the backend or stored
// anywhere — it lives only in this tab's memory for the duration of the
// visit, same privacy stance as the rest of the app's PII handling.
//
// This deliberately overestimates accuracy less than it sounds: straight-
// line distance understates real road distance, so ROUTE_FACTOR corrects
// for that, and ASSUMED_SPEED_KMH is a conservative urban-Nairobi guess,
// not real traffic data. Good enough to validate whether citizens want
// this feature before paying for Mapbox's traffic-aware Directions API
// (Phase 2 — see improvemnt.md).
const ASSUMED_SPEED_KMH = 20;
const ROUTE_FACTOR = 1.4;

export function geolocationSupported() {
  return "geolocation" in navigator;
}

export function requestLocation() {
  return new Promise((resolve) => {
    if (!geolocationSupported()) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => resolve(null), // denied or failed — treat identically, caller just doesn't get an estimate
      { timeout: 10_000, maximumAge: 5 * 60_000 }
    );
  });
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function estimateTravelSeconds(fromLat, fromLon, toLat, toLon) {
  const straightLineKm = haversineKm(fromLat, fromLon, toLat, toLon);
  const roadKm = straightLineKm * ROUTE_FACTOR;
  return (roadKm / ASSUMED_SPEED_KMH) * 3600;
}

// Phase 2: real traffic-aware ETA via Mapbox's Directions API, called
// directly from the browser. This is intentional, not a shortcut — Mapbox
// public tokens ("pk.*", as opposed to secret "sk.*" tokens) are designed
// for exactly this client-side use, and calling it from here rather than
// routing through our backend means the citizen's coordinates still never
// touch our server at all, preserving the same "location never leaves
// this tab" privacy property Phase 1 established. Falls back to the
// Phase 1 straight-line estimate on any failure (no token configured,
// network error, Mapbox outage) — never blocks the feature.
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;

export function mapboxConfigured() {
  return Boolean(MAPBOX_TOKEN);
}

export async function fetchTrafficAwareEtaSeconds(fromLat, fromLon, toLat, toLon) {
  if (!MAPBOX_TOKEN) return null;
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/` +
    `${fromLon},${fromLat};${toLon},${toLat}` +
    `?access_token=${MAPBOX_TOKEN}&overview=false`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data.routes?.[0]?.duration ?? null; // seconds, already traffic-adjusted
  } catch {
    return null;
  }
}

/** Best estimate available: real traffic ETA if Mapbox is configured and
 * reachable, otherwise the free straight-line fallback. Always resolves —
 * never throws, never leaves the citizen without an estimate. */
export async function bestTravelEstimateSeconds(fromLat, fromLon, toLat, toLon) {
  const traffic = await fetchTrafficAwareEtaSeconds(fromLat, fromLon, toLat, toLon);
  if (traffic != null) return { seconds: traffic, source: "traffic" };
  return { seconds: estimateTravelSeconds(fromLat, fromLon, toLat, toLon), source: "estimate" };
}
