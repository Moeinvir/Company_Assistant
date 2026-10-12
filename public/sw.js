/*
 * Parsis Bridge service worker.
 *
 * The app is local-first (its data lives in browser storage), so an offline
 * shell is genuinely usable offline. Strategy:
 *
 *   - navigations  → network first with a short timeout, fall back to the
 *                    cached shell so the SPA router takes over offline
 *   - /assets/*   → stale-while-revalidate: Vite fingerprints these, so a
 *                    cached copy is always a valid build
 *   - everything else passes through untouched
 */
const VERSION = "parsis-v1";
const SHELL_CACHE = VERSION + "-shell";
const RUNTIME_CACHE = VERSION + "-runtime";

const SHELL_FILES = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstShell(request));
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Everything else (manifest, icons, embed.js): try the network, then fall
  // back to whatever is cached so no same-origin asset 404s offline.
  event.respondWith(
    fetch(request).catch(
      async () => (await caches.match(request)) ?? Response.error(),
    ),
  );
});

async function networkFirstShell(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put("/", response.clone());
    }
    return response;
  } catch {
    const cached = (await caches.match("/")) ?? (await caches.match(request));
    if (cached) return cached;
    throw new Error("Offline and no cached shell");
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached ?? refresh.then((response) => response ?? Response.error());
}
