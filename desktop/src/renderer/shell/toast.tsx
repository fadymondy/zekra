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
      offset={16}
      gap={8}
      toastOptions={{
        // Theme-derived, like a native HUD: the popover surface, hairline, soft shadow.
        style: {
          background: "var(--popover)",
          color: "var(--popover-foreground)",
          border: "1px solid var(--border)",
          borderRadius: "calc(var(--radius) + 3px)",
          fontFamily: "var(--grid-font-sans)",
          fontSize: "var(--fs-ui)",
          boxShadow: "0 10px 30px -10px rgb(0 0 0 / 0.35)",
        },
      }}
    />
  );
}

export { toast };
