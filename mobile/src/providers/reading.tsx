import { useEffect, useState, type ReactNode } from "react";

import {
  DEFAULT_READING,
  ReadingContext,
  loadReading,
  saveReading,
  type ReadingSettings,
} from "@/lib/reading-settings";

/*
Holds the reading preferences for the whole app.

One store, not one useState per screen: the web shipped the per-caller version
first and the settings screen wrote to storage while the note surface never
heard about it — "it's not even reflected in the UI". Mobile gets the shared
store from the start.

Persistence is fire-and-forget on purpose. A failed write means the preference
does not survive a restart; blocking the UI on the Keychain to find that out
would be worse than the loss.
*/
export function ReadingProvider({ children }: { children: ReactNode }) {
  const [reading, setLocal] = useState<ReadingSettings>(DEFAULT_READING);

  useEffect(() => {
    let live = true;
    void loadReading().then((s) => { if (live) setLocal(s); });
    return () => { live = false; };
  }, []);

  return (
    <ReadingContext.Provider
      value={{
        reading,
        setReading: (next) => { setLocal(next); void saveReading(next); },
      }}
    >
      {children}
    </ReadingContext.Provider>
  );
}
