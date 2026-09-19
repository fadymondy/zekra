/** @type {import('next').NextConfig} */
// The Go API (cmd/api) — console, REST, SSE and the install scripts live behind it.
const API_ORIGIN = process.env.API_ORIGIN ?? "http://localhost:8080";

const nextConfig = {
  // Self-contained server (.next/standalone) for production, as in Managy.
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1", "localhost", "app.zekra.dev"],

  // The Go API and this app share one origin: session and CSRF cookies stay first-party.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` },
      { source: "/graphql", destination: `${API_ORIGIN}/graphql` },
      { source: "/events", destination: `${API_ORIGIN}/events` },
      { source: "/install.sh", destination: `${API_ORIGIN}/install.sh` },
      { source: "/upgrade.sh", destination: `${API_ORIGIN}/upgrade.sh` },
    ];
  },

  // The service worker (PWA) must never be cached, or clients keep an old version forever.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
