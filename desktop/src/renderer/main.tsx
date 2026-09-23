import { createRoot } from "react-dom/client";

import { App } from "./app";

// Paint the right ground before React mounts: main already set
// nativeTheme.themeSource from the saved theme, so prefers-color-scheme
// reflects the app's choice (not just macOS) and there is no dark/light flash.
{
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.dataset.theme = dark ? "dark" : "light";
  // A first guess for the pre-mount paint; lib/platform.ts sets the real
  // platform / material from the main process before the first render.
  root.dataset.platform = /Mac/i.test(navigator.platform) ? "darwin" : /Win/i.test(navigator.platform) ? "win32" : "linux";
}

createRoot(document.getElementById("root")!).render(<App />);
