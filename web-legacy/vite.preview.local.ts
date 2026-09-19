import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
// Local-only visual preview against production data (not committed).
const target = "https://cabrain-app.fadymondy.com";
const headers = { "X-Zekra-Token": process.env.ZT || "", "X-Agent-Id": "fadymondy-agent" };
export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: "noauth",
    configureServer(s) {
      s.middlewares.use((req, res, next) => {
        if (req.url?.startsWith("/api/brain/ping")) { res.setHeader("content-type","application/json"); res.end('{"ok":true,"authRequired":false}'); return; }
        next();
      });
    },
  }],
  server: { port: 3077, proxy: {
    "/api": { target, changeOrigin: true, headers },
    "/events": { target, changeOrigin: true, headers },
  } },
});
