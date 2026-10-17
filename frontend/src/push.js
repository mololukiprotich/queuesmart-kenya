// Web Push subscription — the free "it's your turn" notification channel.
// Registering the service worker and asking for permission are separate
// from subscribing to a specific phone number, so a citizen who already
// granted permission on an earlier visit can re-subscribe silently.
import { api } from "./api";

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window;
}

function urlBase64ToUint8Array(base64url) {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Registers the service worker (idempotent — safe to call every visit),
 * requests notification permission if not already decided, subscribes to
 * push, and links the subscription to `phone` on the backend. Returns
 * false (never throws) if the browser doesn't support push, permission is
 * denied, or anything else goes wrong — this is a nice-to-have layered on
 * top of the WebSocket live-update flow, not something the ticket flow
 * should ever block on.
 */
export async function enablePushForPhone(phone) {
  if (!pushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");

    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    if (permission !== "granted") return false;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      const { public_key } = await api.getPushVapidPublicKey();
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(public_key),
      });
    }

    const json = subscription.toJSON();
    await api.pushSubscribe({
      phone,
      endpoint: json.endpoint,
      keys: json.keys,
    });
    return true;
  } catch {
    return false;
  }
}
