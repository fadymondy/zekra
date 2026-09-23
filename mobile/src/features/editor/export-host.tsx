import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { useAuth } from "@/providers/auth";

import { decodeFromEngine, injectionFor, type EngineDir, type EngineExportFormat, type ToEngine } from "./bridge-core";
import { useEngineConfig } from "./engine-config";
import { EXPORT_HTML } from "./export-html.gen";
import { resolveNoteImage } from "./image-cache";

/*
The hidden page that runs web's exporters (html / txt / docx / png) for
exportNote() (export.ts).

MOUNT ONCE, at the root, inside AuthProvider (it needs the session for note
images and for fetching a body the caller did not have). It renders nothing
until an export is requested, then mounts an invisible WebView, and unmounts
it again after a minute idle — so it costs nothing in a session that never
exports.

exportNote talks to it through a module-level handle rather than context, so
any screen (the note screen, the notes list's row menu) can export without
being wrapped in anything.
*/

export type EngineExportRequest = {
  format: EngineExportFormat;
  markdown: string;
  title: string;
  themeId: string | null;
  dir: EngineDir;
};

export type EngineExportResult = { data: string; encoding: "base64" | "utf8" };

type Job = EngineExportRequest & {
  id: number;
  resolve: (r: EngineExportResult) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type HostHandle = { run(job: Job): void; token: string | null };

let host: HostHandle | null = null;
const hostWaiters = new Set<() => void>();
let seq = 0;

const JOB_TIMEOUT_MS = 60_000;
const IDLE_UNMOUNT_MS = 60_000;

function waitForHost(ms: number): Promise<HostHandle | null> {
  if (host) return Promise.resolve(host);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      hostWaiters.delete(done);
      resolve(host);
    };
    const timer = setTimeout(done, ms);
    hostWaiters.add(done);
  });
}

/** The signed-in session's token, for export.ts (null if no host / signed out). */
export async function exportHostToken(): Promise<string | null> {
  return (await waitForHost(1500))?.token ?? null;
}

/** Run one export on the hidden page. Rejects if <ExportHost/> is not mounted. */
export async function runEngineExport(request: EngineExportRequest): Promise<EngineExportResult> {
  const h = await waitForHost(1500);
  if (!h) throw new Error("ExportHost is not mounted");
  return new Promise<EngineExportResult>((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => reject(new Error("export timed out")), JOB_TIMEOUT_MS);
    h.run({ ...request, id, resolve, reject, timer });
  });
}

const SOURCE = { html: EXPORT_HTML };

export function ExportHost() {
  const { token } = useAuth();
  const config = useEngineConfig();
  const [active, setActive] = useState(false);
  const web = useRef<WebView>(null);
  const ready = useRef(false);
  const queue = useRef<Job[]>([]);
  const running = useRef(new Map<number, Job>());
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const configRef = useRef(config);
  configRef.current = config;

  const send = useCallback((msg: ToEngine) => {
    if (ready.current) web.current?.injectJavaScript(injectionFor(msg));
  }, []);

  const pump = useCallback(() => {
    if (!ready.current) return;
    for (const job of queue.current.splice(0)) {
      running.current.set(job.id, job);
      send({ type: "export", id: job.id, format: job.format, markdown: job.markdown, title: job.title, themeId: job.themeId, dir: job.dir });
    }
  }, [send]);

  const scheduleIdle = useCallback(() => {
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => {
      if (queue.current.length || running.current.size) return;
      ready.current = false;
      setActive(false);
    }, IDLE_UNMOUNT_MS);
  }, []);

  useEffect(() => {
    const handle: HostHandle = {
      token: tokenRef.current,
      run(job) {
        if (idle.current) clearTimeout(idle.current);
        queue.current.push(job);
        setActive(true);
        pump();
      },
    };
    host = handle;
    for (const wake of [...hostWaiters]) wake();
    return () => {
      if (host === handle) host = null;
      for (const job of [...queue.current, ...running.current.values()]) {
        clearTimeout(job.timer);
        job.reject(new Error("export cancelled"));
      }
      queue.current = [];
      running.current.clear();
      if (idle.current) clearTimeout(idle.current);
    };
  }, [pump]);

  // Keep the handle's token current without re-registering.
  useEffect(() => {
    if (host) host.token = token;
  }, [token]);

  // PNG exports use the current reading theme; keep the page in step.
  useEffect(() => {
    send({ type: "setTheme", theme: config.theme });
  }, [config.theme, send]);
  useEffect(() => {
    send({ type: "setTypography", typography: config.typography });
  }, [config.typography, send]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const msg = decodeFromEngine(event.nativeEvent.data);
      if (!msg) return;
      switch (msg.type) {
        case "ready": {
          ready.current = true;
          const c = configRef.current;
          send({ type: "init", markdown: "", editable: false, theme: c.theme, typography: c.typography, dir: c.dir, strings: c.strings, autofocus: false });
          pump();
          break;
        }
        case "imageRequest":
          void resolveNoteImage(msg.src, tokenRef.current).then((url) =>
            send(url ? { type: "imageResolved", src: msg.src, url } : { type: "imageFailed", src: msg.src }),
          );
          break;
        case "exportResult": {
          const job = running.current.get(msg.id);
          if (!job) break;
          running.current.delete(msg.id);
          clearTimeout(job.timer);
          if (msg.ok && typeof msg.data === "string") job.resolve({ data: msg.data, encoding: msg.encoding ?? "utf8" });
          else job.reject(new Error(msg.error || "export failed"));
          if (!running.current.size && !queue.current.length) scheduleIdle();
          break;
        }
        case "error":
          // A page-level failure fails whatever is running, so the caller
          // hears about it instead of waiting for the timeout.
          for (const job of running.current.values()) {
            clearTimeout(job.timer);
            job.reject(new Error(msg.message));
          }
          running.current.clear();
          break;
        default:
          break;
      }
    },
    [pump, scheduleIdle, send],
  );

  const onGone = useCallback(() => {
    ready.current = false;
    for (const job of running.current.values()) {
      clearTimeout(job.timer);
      job.reject(new Error("export page stopped"));
    }
    running.current.clear();
    setActive(false);
  }, []);

  if (!active) return null;
  return (
    <View pointerEvents="none" style={styles.hidden} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <WebView
        ref={web}
        source={SOURCE}
        originWhitelist={["*"]}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={(r) => (r.url ?? "").startsWith("about:") || (r.url ?? "").startsWith("data:")}
        javaScriptEnabled
        setSupportMultipleWindows={false}
        onContentProcessDidTerminate={onGone}
        onRenderProcessGone={onGone}
        style={styles.web}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Laid out (so the page runs and can measure), never seen or touched.
  hidden: { position: "absolute", top: 0, left: 0, width: 360, height: 480, opacity: 0, zIndex: -1 },
  web: { flex: 1, backgroundColor: "transparent" },
});
