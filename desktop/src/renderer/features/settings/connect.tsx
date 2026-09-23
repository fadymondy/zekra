import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Loader2 } from "lucide-react";

import type { McpInstallStatus, McpTarget } from "../../../shared/ipc";

import { Button } from "@/components/ui/button";

import { bridge } from "../../lib/bridge";
import { useI18n } from "../../lib/i18n";
import { useSession } from "../../shell/session";
import { toast } from "../../shell/toast";
import { MCP_URL } from "./api";
import { Group, Row, SettingsHeader } from "./ui";

/*
Settings ▸ Connect — mobile's Connect screen (the MCP endpoint agents use, the
web console) plus Mark It Down's tray installer: "Install" writes a `zekra`
entry for the remote MCP server into ~/.claude.json (Claude Code) or
~/.cursor/mcp.json (Cursor). The main process asks for confirmation natively,
backs the file up and writes it atomically (src/main/mcp-install.ts).
*/

const TOOLS: { id: McpTarget; name: string; file: string }[] = [
  { id: "claude", name: "Claude Code", file: "~/.claude.json" },
  { id: "cursor", name: "Cursor", file: "~/.cursor/mcp.json" },
];

export function ConnectSettings() {
  const { t } = useI18n();
  const { settings } = useSession();
  const [status, setStatus] = useState<McpInstallStatus | null>(null);
  const [running, setRunning] = useState<McpTarget | null>(null);

  const refresh = useCallback(() => {
    void bridge()
      .getMcpStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);
  useEffect(refresh, [refresh]);

  async function copy(value: string) {
    await bridge().writeClipboardText(value);
    toast.success(t("settings.copied"));
  }

  async function install(tool: (typeof TOOLS)[number]) {
    setRunning(tool.id);
    try {
      const res = await bridge().installMcp(tool.id, MCP_URL);
      if (res.status === "installed") toast.success(t("mcp.installedToast", { tool: tool.name }), { description: res.backup });
      else if (res.status === "error") toast.error(t("mcp.failed", { tool: tool.name, error: res.message ?? "" }));
    } catch (e) {
      toast.error(t("mcp.failed", { tool: tool.name, error: e instanceof Error ? e.message : "" }));
    } finally {
      setRunning(null);
      refresh();
    }
  }

  return (
    <>
      <SettingsHeader title={t("settings.connect")} description={t("settings.mcpBody")} />

      <Group title={t("settings.mcp")}>
        <Row label={t("settings.mcpUrl")}>
          <code dir="ltr" className="font-grid-mono text-xs text-grid-gold">
            {MCP_URL}
          </code>
          <Button variant="ghost" size="icon-sm" aria-label={t("settings.copy")} title={t("settings.copy")} onClick={() => void copy(MCP_URL)}>
            <Copy />
          </Button>
        </Row>
        <Row label={t("settings.mcpAuth")}>
          <span className="text-xs text-muted-foreground">{t("settings.mcpAuthValue")}</span>
        </Row>
      </Group>

      <Group title={t("mcp.installTitle")} description={t("mcp.installBody")}>
        {TOOLS.map((tool) => {
          const installed = status?.[tool.id] === true;
          return (
            <Row
              key={tool.id}
              label={tool.name}
              hint={
                <span dir="ltr" className="font-grid-mono" style={{ unicodeBidi: "isolate" }}>
                  {tool.file}
                </span>
              }
            >
              {installed ? (
                <span className="flex items-center gap-1 text-xs text-grid-ok">
                  <Check className="size-3.5" />
                  {t("mcp.installed")}
                </span>
              ) : null}
              <Button variant={installed ? "ghost" : "outline"} size="sm" disabled={running !== null} onClick={() => void install(tool)}>
                {running === tool.id ? <Loader2 className="animate-spin" /> : null}
                {installed ? t("mcp.reinstall") : t("mcp.install")}
              </Button>
            </Row>
          );
        })}
      </Group>

      <Group>
        <Row
          label={t("settings.openConsole")}
          hint={
            <span dir="ltr" className="font-grid-mono" style={{ unicodeBidi: "isolate" }}>
              {settings.apiBaseUrl.replace(/^https?:\/\//, "")}
            </span>
          }
        >
          <Button variant="outline" size="sm" onClick={() => void bridge().openExternal(settings.apiBaseUrl)}>
            <ExternalLink />
            {t("settings.openConsole")}
          </Button>
        </Row>
      </Group>
    </>
  );
}
