// Zekra service worker. Keeps the installed app usable offline without ever serving stale data:
//   - /_next/static/* and /icons/* are content-hashed or immutable → cache-first;
//   - page navigations are network-first; offline they fall back to the last copy of that page,
//     then to /offline.html;
//   - the API (/api, /events, /graphql) and everything cross-origin are never touched.
const VERSION = "zekra-v1"
const STATIC = `${VERSION}-static`
const PAGES = `${VERSION}-pages`
const OFFLINE = "/offline.html"

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC).then((c) => c.addAll([OFFLINE, "/icons/icon-192.png"])))
  self.skipWaiting()
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (/^\/(api|events|graphql)(\/|$)/.test(url.pathname)) return

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) caches.open(STATIC).then((c) => c.put(req, res.clone()))
            return res
          }),
      ),
    )
    return
  }

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(PAGES).then((c) => c.put(req, res.clone()))
          return res
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match(OFFLINE))),
    )
  }
})
