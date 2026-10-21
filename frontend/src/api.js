// Thin fetch wrapper. Centralized here so the base URL (the only thing that
// changes between dev and a deployed pilot) lives in exactly one place.
import { getSession, clearSession } from "./auth";

// VITE_API_BASE lets the same build point at a real backend when deployed
// (Vercel, or a phone on the same LAN during device testing) — falls back
// to localhost for `npm run dev`. Set in .env.local for dev overrides, or
// as a Vercel project env var for the deployed build.
const BASE = `${import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000"}/api`;

async function request(path, options = {}, { auth = false } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const session = getSession();
    if (session) headers["Authorization"] = `Bearer ${session.token}`;
  }
  const res = await fetch(`${BASE}${path}`, { headers, ...options });
  if (res.status === 401 && auth) {
    // Session expired or server restarted (in-memory sessions don't survive
    // a restart — see backend/app/auth.py) — drop the stale local session
    // so the Staff page's gate kicks the user back to the login form.
    clearSession();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  listBranches: () => request("/branches"),
  listServices: (branchId) => request(`/branches/${branchId}/services`),
  createTicket: (service_id, phone, profile = {}) =>
    request("/tickets", { method: "POST", body: JSON.stringify({ service_id, phone, ...profile }) }),
  getTicketState: (ticketId) => request(`/tickets/${ticketId}`),
  setNotifyThresholds: (ticketId, thresholdsSeconds) =>
    request(`/tickets/${ticketId}/notify-thresholds`, {
      method: "PATCH",
      body: JSON.stringify({ thresholds_seconds: thresholdsSeconds }),
    }),
  getProfileAutofill: (phone) => request(`/citizens/${encodeURIComponent(phone)}/profile`),

  getPushVapidPublicKey: () => request("/push/vapid-public-key"),
  pushSubscribe: (payload) => request("/push/subscribe", { method: "POST", body: JSON.stringify(payload) }),

  requestOtp: (phone) => request("/otp/request", { method: "POST", body: JSON.stringify({ phone }) }),
  verifyOtp: (phone, code) => request("/otp/verify", { method: "POST", body: JSON.stringify({ phone, code }) }),
  checkCitizenSession: (token) => request("/otp/session", { headers: { "X-Session-Token": token } }),

  staffLogin: (username, password) =>
    request("/staff/login", { method: "POST", body: JSON.stringify({ username, password }) }),

  listCounters: () => request("/staff/counters", {}, { auth: true }),
  counterQueue: (counterId) => request(`/staff/counters/${counterId}/queue`, {}, { auth: true }),
  callNext: (counterId) => request(`/staff/counters/${counterId}/call-next`, { method: "POST" }, { auth: true }),
  completeTicket: (ticketId) => request(`/staff/tickets/${ticketId}/complete`, { method: "POST" }, { auth: true }),
  noShow: (ticketId) => request(`/staff/tickets/${ticketId}/no-show`, { method: "POST" }, { auth: true }),

  getHistory: (phone) => request(`/citizens/${encodeURIComponent(phone)}/history`),

  adminStats: () => request("/admin/stats", {}, { auth: true }),
  adminTimeseries: (hours = 12) => request(`/admin/timeseries?hours=${hours}`, {}, { auth: true }),
};

export function wsUrlForService(serviceId) {
  const httpBase = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";
  const wsBase = httpBase.replace(/^http/, "ws"); // https -> wss, http -> ws
  return `${wsBase}/api/ws/services/${serviceId}`;
}
