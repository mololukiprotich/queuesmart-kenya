// Service worker — only job right now is Web Push. Kept framework-free and
// outside src/ (not bundled by Vite) since the browser fetches this file
// directly from the root, before any app code has run.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = { title: "QueueSmart", body: "Your queue status has changed." };
  try {
    if (event.data) data = event.data.json();
  } catch {
    // non-JSON payload — fall back to the default above
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/favicon.svg",
      badge: "/favicon.svg",
      tag: "queuesmart-ticket", // replaces any earlier notification instead of stacking
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients.find((c) => c.url.includes(self.location.origin));
      if (existing) return existing.focus();
      return self.clients.openWindow("/citizen");
    })
  );
});
