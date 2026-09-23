import { Toaster as Sonner, toast } from "sonner";

import { useI18n } from "../lib/i18n";

/*
The toast system: sonner, styled exactly like the web console's
(web/components/providers.tsx ThemedToaster) so a toast looks the same in both
apps. Mounted once by the shell; anywhere in the renderer:

    import { toast } from "../shell/toast";
    toast.success(t("notes.x.pinned"));
    toast.error(message);
*/

export function Toaster({ theme }: { theme: "light" | "dark" }) {
  const { dir } = useI18n();
  return (
    <Sonner
      theme={theme}
      dir={dir}
      // Bottom corner on the reading side's far end, above the status bar.
      position={dir === "rtl" ? "bottom-left" : "bottom-right"}
      offset={36}
      toastOptions={{
        style: {
          background: "var(--grid-elevated)",
          color: "var(--grid-fg)",
          border: "1px solid var(--grid-elevated-line)",
          fontFamily: "var(--grid-font-sans)",
        },
      }}
    />
  );
}

export { toast };
