import { useEffect } from "react";
import { BrainCircuit } from "lucide-react";

import { NewBrainForm } from "../features/brains/brain-dialogs";
import { bridge } from "../lib/bridge";
import { useI18n } from "../lib/i18n";
import { usePlatform } from "../lib/platform";
import { useSession } from "../shell/session";
import { controlsPadding, useWindowControls } from "../shell/toolbar";

/*
The New Brain window (src/main/app-windows.ts showNewBrainWindow) — File ▸ New
Brain (⇧⌘N), the sidebar's "+", the Brains toolbar, Spotlight and the tray.
A small fixed window with the create form (features/brains/brain-dialogs.tsx
NewBrainForm). On create it tells the other windows ("brains-changed"), makes
the brain the active one, brings the main window forward — which reloads and
opens it — and closes. Esc / ⌘W cancel.
*/
export function NewBrainWindow() {
  const { t } = useI18n();
  const { user, token, patch } = useSession();
  const { platform } = usePlatform();
  const controls = useWindowControls();

  useEffect(() => {
    document.title = t("brains.new.title");
  }, [t]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void bridge().closeWindow();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function created(ns: string) {
    await patch({ activeBrain: ns }).catch(() => undefined);
    await bridge().broadcast?.({ kind: "brains-changed", open: ns });
    await bridge().openInMain?.(""); // bring the main window forward (it opens the brain)
    void bridge().closeWindow();
  }


  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header
        className="app-drag app-chrome flex shrink-0 items-center gap-2.5 px-6"
        style={{ height: "calc(var(--titlebar-h) + 12px)", ...controlsPadding(controls) }}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <BrainCircuit className="size-[18px]" strokeWidth={1.75} />
        </span>
        <h1 className="text-[17px] font-semibold text-foreground">{t("brains.new.title")}</h1>
      </header>
      {user && token ? (
        <NewBrainForm onCreated={(ns) => void created(ns)} onCancel={() => void bridge().closeWindow()} />
      ) : (
        <p className="m-auto px-6 text-center text-ui text-muted-foreground">{t("shell.signedOut")}</p>
      )}
    </div>
  );
}
