import { useEffect, useState } from "react";

import { useI18n } from "../lib/i18n";
import { useRouter } from "./router";
import { useSession } from "./session";
import { Slot } from "./slots";

/*
The status bar (24px, bottom). START: connection state and the open brain,
then the "statusbar.start" slot. END: the "statusbar.end" slot — word count,
cursor position, sync state… published by whichever screen owns them
(useSlot("statusbar.end", …)).
*/

export const STATUSBAR_HEIGHT = 24;

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

export function StatusBar() {
  const { t } = useI18n();
  const online = useOnline();
  const { route } = useRouter();
  const { brains, settings } = useSession();
  const ns = route.name === "brain" ? route.ns : settings.activeBrain;
  const brain = ns ? brains?.find((b) => b.namespace === ns) : undefined;

  return (
    <footer
      className="flex shrink-0 items-center gap-3 border-t border-line bg-grid-bg px-3 text-[11px] text-grid-muted"
      style={{ height: STATUSBAR_HEIGHT }}
    >
      <span className="flex items-center gap-1.5">
        <span aria-hidden className={online ? "size-1.5 rounded-full bg-grid-ok" : "size-1.5 rounded-full bg-grid-danger"} />
        {online ? t("shell.online") : t("shell.offline")}
      </span>
      <span className="truncate" style={{ unicodeBidi: "plaintext" }}>
        {brain ? brain.displayName || brain.namespace : t("shell.noBrain")}
      </span>
      <Slot name="statusbar.start" />
      <div className="ms-auto flex items-center gap-3">
        <Slot name="statusbar.end" />
      </div>
    </footer>
  );
}
