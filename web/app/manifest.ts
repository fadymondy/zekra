import type { MetadataRoute } from "next"

// Installable Zekra (PWA): the console opens standalone from the home screen or dock.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Zekra — ذكرة",
    short_name: "Zekra",
    description: "Shared long-term memory for AI agents — notes, brains and MCP.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0B1429",
    theme_color: "#0B1429",
    categories: ["productivity", "developer tools"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
