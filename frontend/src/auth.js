// Staff session storage. Deliberately tiny — no context provider, just a
// localStorage-backed pair of functions, since only the Staff page tree
// reads this. Kept separate from api.js so components can check "am I
// logged in" synchronously without importing the fetch layer.
const TOKEN_KEY = "qs_staff_token";
const STAFF_KEY = "qs_staff_info";

export function getSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  const raw = localStorage.getItem(STAFF_KEY);
  if (!token || !raw) return null;
  try {
    return { token, staff: JSON.parse(raw) };
  } catch {
    return null;
  }
}

export function setSession(token, staff) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(STAFF_KEY, JSON.stringify(staff));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(STAFF_KEY);
}

export function isAdmin(staff) {
  return staff?.role === "supervisor" || staff?.role === "admin";
}
