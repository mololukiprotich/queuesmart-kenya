// Persisted "remember this phone" session for citizens, separate from
// auth.js (which is the staff login session). Stored client-side only as
// {token, phone} — the token is meaningless without the backend's
// citizen_sessions row, so losing/clearing it just means re-verifying.
const KEY = "qs_citizen_session";

export function getCitizenSession() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setCitizenSession(session) {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearCitizenSession() {
  localStorage.removeItem(KEY);
}
