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
  root.dataset.platform = window.zekra ? (/Mac/i.test(navigator.platform) ? "darwin" : "other") : "browser";
}

createRoot(document.getElementById("root")!).render(<App />);
