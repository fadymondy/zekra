import { useEffect, useState } from "react";
import { Download, ExternalLink, FileText, LifeBuoy, Mail, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";

import { ZekraMark } from "../../components/zekra-mark";
import { bridge, type AppInfo } from "../../lib/bridge";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../shell/session";
import { headline } from "../updates/update-sheet";
import { canCheck, installNow, openUpdateSheet, useUpdateState } from "../updates/use-update";
import { SUPPORT_EMAIL, legalUrl } from "./api";
import { Group, Row, Segmented } from "./ui";

/*
Settings ▸ About: the build (version, platform), Software Update (the updater
IPC — electron-updater against GitHub Releases; development and --dir builds
report "disabled"): status + Check for Updates / Restart to Update, the
release notes sheet, the channel (stable / beta) and the auto-install switch
(settings autoInstallUpdates / updateChannel, src/main/updater.ts), the legal
pages on zekra.dev (mobile links out the same way) and the web console.
*/
export function AboutSettings() {
  const { t, locale } = useI18n();
  const { settings, version, patch } = useSession();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const update = useUpdateState();

  useEffect(() => {
    void bridge().getAppInfo().then(setInfo);
  }, []);

  const status = update?.status ?? "idle";
  const statusText = headline(t, update);
  const disabled = status === "disabled";
  const checkedAt = update?.checkedAt ? new Date(update.checkedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" }) : "";

  const open = (url: string) => void bridge().openExternal(url);

  return (
    <>
      <div className="flex items-center gap-4">
        <span className="flex size-14 items-center justify-center rounded-xl border border-border/60 bg-pane-raised">
          <ZekraMark size={34} />
        </span>
        <div>
          <h1 className="text-lg font-medium text-foreground">{t("settingsx.appName")}</h1>
          <p dir="ltr" className="font-grid-mono text-xs text-muted-foreground" style={{ unicodeBidi: "isolate" }}>
            {version || info?.version}
            {info && info.platform !== "browser" ? ` · ${info.platform} ${info.arch}` : ""}
          </p>
        </div>
      </div>

      <Group title={t("settingsx.updates")}>
        <Row
          label={
            <span>
              {t("dupd.current")}{" "}
              <span dir="ltr" className="font-grid-mono text-xs text-muted-foreground" style={{ unicodeBidi: "isolate" }}>
                {update?.currentVersion || version || info?.version}
              </span>
            </span>
          }
          hint={
            <span className={status === "error" ? "text-destructive" : undefined} title={status === "error" ? update?.message : undefined}>
              {statusText}
              {checkedAt && !disabled ? ` · ${t("dupd.lastChecked", { when: checkedAt })}` : ""}
            </span>
          }
        >
          {status === "downloaded" ? (
            <Button onClick={installNow}>
              <Download />
              {t("dupd.restart")}
            </Button>
          ) : (
            <Button variant="outline" disabled={disabled || !canCheck(update)} onClick={() => void bridge().checkForUpdates()}>
              <RefreshCw className={status === "checking" ? "animate-spin" : undefined} />
              {t("dupd.check")}
            </Button>
          )}
        </Row>
        {status === "downloading" ? (
          <div className="px-4 py-3">
            <Progress value={update?.progress ?? 0} />
          </div>
        ) : null}
        {update?.releaseNotes && (status === "available" || status === "downloading" || status === "downloaded") ? (
          <LinkRow icon={Sparkles} label={t("dupd.whatsNew")} external={false} onClick={() => openUpdateSheet()} />
        ) : null}
        <Row label={t("dupd.channel")} hint={t("dupd.channelHint")}>
          <Segmented<"stable" | "beta">
            label={t("dupd.channel")}
            value={settings.updateChannel === "beta" ? "beta" : "stable"}
            options={[
              { value: "stable", label: t("dupd.stable") },
              { value: "beta", label: t("dupd.beta") },
            ]}
            onChange={(v) => void patch({ updateChannel: v })}
          />
        </Row>
        <Row label={t("dupd.auto")} hint={t("dupd.autoHint")}>
          <Switch
            checked={settings.autoInstallUpdates !== false}
            onCheckedChange={(v) => void patch({ autoInstallUpdates: v })}
            aria-label={t("dupd.auto")}
          />
        </Row>
      </Group>

      <Group title={t("settings.legal")}>
        <LinkRow icon={ShieldCheck} label={t("legal.privacy")} onClick={() => open(legalUrl("privacy", locale))} />
        <LinkRow icon={FileText} label={t("legal.terms")} onClick={() => open(legalUrl("terms", locale))} />
        <LinkRow icon={LifeBuoy} label={t("legal.support")} onClick={() => open(legalUrl("support", locale))} />
        <LinkRow icon={Mail} label={SUPPORT_EMAIL} mono onClick={() => open(`mailto:${SUPPORT_EMAIL}`)} />
        <LinkRow icon={ExternalLink} label={t("settings.openConsole")} onClick={() => open(settings.apiBaseUrl)} />
      </Group>
    </>
  );
}

function LinkRow({ icon: Icon, label, onClick, mono, external = true }: {
  icon: typeof Mail;
  label: string;
  onClick: () => void;
  mono?: boolean;
  external?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-3 px-4 py-3 text-start text-sm text-foreground hover:bg-hover">
      <Icon className="size-4 text-muted-foreground" />
      <span className={mono ? "font-grid-mono text-xs" : undefined} dir={mono ? "ltr" : undefined}>
        {label}
      </span>
      {external ? <ExternalLink className="ms-auto size-3.5 text-muted-foreground" /> : null}
    </button>
  );
}
