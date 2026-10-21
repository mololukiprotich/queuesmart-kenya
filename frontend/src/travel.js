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
