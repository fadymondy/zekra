import { useEffect, useState } from "react";
import { Download, ExternalLink, FileText, LifeBuoy, Mail, RefreshCw, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

import { ZekraMark } from "../../components/zekra-mark";
import { bridge, type AppInfo, type UpdateState } from "../../lib/bridge";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../shell/session";
import { SUPPORT_EMAIL, legalUrl } from "./api";
import { Group, Row } from "./ui";

/*
Settings ▸ About: the build (version, platform), updates through the updater
IPC (electron-updater against GitHub Releases; development builds report
"disabled"), the legal pages on zekra.dev (mobile links out the same way) and
the web console.
*/
export function AboutSettings() {
  const { t, locale } = useI18n();
  const { settings, version } = useSession();
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [update, setUpdate] = useState<UpdateState | null>(null);

  useEffect(() => {
    void bridge().getAppInfo().then(setInfo);
    void bridge().getUpdateState().then(setUpdate);
    return bridge().onUpdateState(setUpdate);
  }, []);

  const status = update?.status ?? "idle";
  const vars = { version: update?.version ?? "", progress: Math.round(update?.progress ?? 0) };
  const statusText =
    status === "checking"
      ? t("settingsx.update.checking")
      : status === "available"
        ? t("settingsx.update.available", vars)
        : status === "downloading"
          ? t("settingsx.update.downloading", vars)
          : status === "downloaded"
            ? t("settingsx.update.downloaded", vars)
            : status === "not-available"
              ? t("settingsx.update.none")
              : status === "disabled"
                ? t("settingsx.update.disabled")
                : status === "error"
                  ? t("settingsx.update.error")
                  : t("settingsx.update.idle");

  const open = (url: string) => void bridge().openExternal(url);

  return (
    <>
      <div className="flex items-center gap-4">
        <span className="flex size-14 items-center justify-center rounded-xl border border-line bg-grid-card">
          <ZekraMark size={34} />
        </span>
        <div>
          <h1 className="text-lg font-medium text-grid-fg">{t("settingsx.appName")}</h1>
          <p dir="ltr" className="font-grid-mono text-xs text-grid-muted" style={{ unicodeBidi: "isolate" }}>
            {version || info?.version}
            {info && info.platform !== "browser" ? ` · ${info.platform} ${info.arch}` : ""}
          </p>
        </div>
      </div>

      <Group title={t("settingsx.updates")}>
        <Row
          label={t("settings.version")}
          hint={
            <span className={status === "error" ? "text-grid-danger" : undefined} title={status === "error" ? update?.message : undefined}>
              {statusText}
            </span>
          }
        >
          {status === "downloaded" ? (
            <Button onClick={() => void bridge().installUpdate()}>
              <Download />
              {t("settings.installUpdate")}
            </Button>
          ) : (
            <Button
              variant="outline"
              disabled={status === "disabled" || status === "checking" || status === "downloading" || status === "available"}
              onClick={() => void bridge().checkForUpdates().then(setUpdate)}
            >
              <RefreshCw className={status === "checking" ? "animate-spin" : undefined} />
              {t("settings.checkUpdates")}
            </Button>
          )}
        </Row>
        {status === "downloading" ? (
          <div className="px-4 py-3">
            <Progress value={update?.progress ?? 0} />
          </div>
        ) : null}
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

function LinkRow({ icon: Icon, label, onClick, mono }: { icon: typeof Mail; label: string; onClick: () => void; mono?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-3 px-4 py-3 text-start text-sm text-grid-fg hover:bg-grid-soft">
      <Icon className="size-4 text-grid-muted" />
      <span className={mono ? "font-grid-mono text-xs" : undefined} dir={mono ? "ltr" : undefined}>
        {label}
      </span>
      <ExternalLink className="ms-auto size-3.5 text-grid-muted" />
    </button>
  );
}
