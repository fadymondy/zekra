import { useEffect, type ReactNode } from "react";

import { hydrateReading } from "@/lib/reading-settings";

/*
Kept for the provider tree in app/_layout.tsx. The reading settings now live in
a module-level store (src/lib/reading-settings.ts) because ThemeProvider —
mounted ABOVE this provider — must repaint the app from the reading theme
(MH-366), and a context owned down here is invisible to it. So this only makes
sure the stored settings are loaded; it holds no state of its own.
*/
export function ReadingProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    void hydrateReading();
  }, []);
  return <>{children}</>;
}
