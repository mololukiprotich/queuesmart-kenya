// "Remember my details on this device" — distinct from citizenSession.js,
// which tracks a server-verified (OTP'd) phone. This is a lower-assurance,
// purely local convenience: whatever the citizen last typed and submitted
// with consent, so a repeat visit only needs a service picked, not every
// field re-typed. Never sent anywhere — it's the same data already
// submitted to the backend once (with consent), just cached locally to
// save re-typing, not a new place PII gets collected.
const KEY = "qs_citizen_details";

export function getSavedDetails() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveDetails(details) {
  localStorage.setItem(KEY, JSON.stringify(details));
}

export function clearSavedDetails() {
  localStorage.removeItem(KEY);
}
