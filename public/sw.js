self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
      return undefined;
    }),
  );
});

self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || msg.type !== "notify") return;
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body || "",
        tag: msg.tag || "dota-spawn-alarm",
      icon: msg.icon,
      badge: msg.icon,
      silent: Boolean(msg.silent),
      renotify: false,
    }),
  );
});
