import * as Clipboard from "expo-clipboard";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Linking, Platform, StyleSheet, View, type ViewStyle } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { ShouldStartLoadRequest } from "react-native-webview/lib/WebViewTypes";

import { toast } from "@/components/kit";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { usePalette } from "@/theme";

import { decodeFromEngine, injectionFor, type EngineMode, type ToEngine, type ToolbarCommand, type ToolbarState } from "./bridge-core";
import { EDITOR_HTML } from "./editor-html.gen";
import { useEngineConfig } from "./engine-config";
import { resolveNoteImage } from "./image-cache";

/*
The note engine (MH-368): a WebView running editor-web/editor-main.mts — the
web console's TipTap schema, markdown renderer and themes — behind a typed
bridge (bridge-core.ts).

RN owns the note (markdown string, saving, uploads, links, clipboard, image
auth); the page owns editing and rendering. Messages before the page says
`ready` are not lost: the page is initialised from the latest props when it
does, and anything sent before that is dropped deliberately (init carries the
full state).
*/

export type NoteEngineHandle = {
  exec(command: ToolbarCommand, arg?: string): void;
  insertImage(url: string, alt?: string): void;
  /** Replace the whole body (reload after a conflict). */
  setMarkdown(markdown: string): void;
  focus(): void;
  blur(): void;
  /** The body as the page has it right now (flushes its debounce). */
  getMarkdown(): Promise<string>;
};

export type PastedImage = { dataUrl: string; mime: string; name: string };

type Props = {
  /** Initial body. Later changes to this prop are ignored — use setMarkdown. */
  markdown: string;
  editable: boolean;
  autofocus?: boolean;
  onChange?: (markdown: string) => void;
  onFocusChange?: (focused: boolean) => void;
  onToolbarState?: (state: ToolbarState) => void;
  onMode?: (mode: EngineMode) => void;
  onPasteImage?: (image: PastedImage) => void;
  style?: ViewStyle;
};

// One object for the lifetime of the app, so the WebView never reloads
// because its source prop changed identity.
const SOURCE = { html: EDITOR_HTML };

export const NoteEngine = forwardRef<NoteEngineHandle, Props>(function NoteEngine(props, ref) {
  const p = usePalette();
  const { t } = useI18n();
  const { token } = useAuth();
  const config = useEngineConfig();
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  // Latest body the page reported — what a reloaded page is re-initialised with.
  const latest = useRef(props.markdown);
  const replies = useRef(new Map<number, (markdown: string) => void>());
  const seq = useRef(0);
  const propsRef = useRef(props);
  propsRef.current = props;
  const configRef = useRef(config);
  configRef.current = config;
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const send = useCallback((msg: ToEngine) => {
    if (!readyRef.current) return;
    web.current?.injectJavaScript(injectionFor(msg));
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      exec: (command, arg) => send({ type: "exec", command, arg }),
      insertImage: (url, alt = "") => send({ type: "insertImage", url, alt }),
      setMarkdown: (markdown) => {
        latest.current = markdown;
        send({ type: "setMarkdown", markdown });
      },
      focus: () => send({ type: "focus" }),
      blur: () => send({ type: "blur" }),
      getMarkdown: () => {
        if (!readyRef.current) return Promise.resolve(latest.current);
        const id = ++seq.current;
        return new Promise<string>((resolve) => {
          const timer = setTimeout(() => {
            replies.current.delete(id);
            resolve(latest.current);
          }, 1500);
          replies.current.set(id, (markdown) => {
            clearTimeout(timer);
            resolve(markdown);
          });
          send({ type: "getMarkdown", id });
        });
      },
    }),
    [send],
  );

  // Live settings: a theme / size change repaints the open note at once (MH-366).
  useEffect(() => {
    send({ type: "setTheme", theme: config.theme });
  }, [config.theme, send]);
  useEffect(() => {
    send({ type: "setTypography", typography: config.typography });
  }, [config.typography, send]);
  useEffect(() => {
    send({ type: "setEditable", editable: props.editable });
  }, [props.editable, send]);

  const init = useCallback(() => {
    const c = configRef.current;
    readyRef.current = true;
    setReady(true);
    send({
      type: "init",
      markdown: latest.current,
      editable: propsRef.current.editable,
      theme: c.theme,
      typography: c.typography,
      dir: c.dir,
      strings: c.strings,
      autofocus: !!propsRef.current.autofocus,
    });
  }, [send]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const msg = decodeFromEngine(event.nativeEvent.data);
      if (!msg) return;
      const cb = propsRef.current;
      switch (msg.type) {
        case "ready":
          init();
          break;
        case "change":
          latest.current = msg.markdown;
          cb.onChange?.(msg.markdown);
          break;
        case "markdown": {
          latest.current = msg.markdown;
          const reply = replies.current.get(msg.id);
          replies.current.delete(msg.id);
          reply?.(msg.markdown);
          break;
        }
        case "mode":
          cb.onMode?.(msg.mode);
          break;
        case "focus":
          cb.onFocusChange?.(true);
          break;
        case "blur":
          cb.onFocusChange?.(false);
          break;
        case "state":
          cb.onToolbarState?.(msg.state);
          break;
        case "pasteImage":
          cb.onPasteImage?.({ dataUrl: msg.dataUrl, mime: msg.mime, name: msg.name });
          break;
        case "link":
          openLink(msg.href, t("editor.linkFailed"));
          break;
        case "copy":
          void Clipboard.setStringAsync(msg.text).then(() => toast(t("kit.copied"), "ok"));
          break;
        case "imageRequest":
          void resolveNoteImage(msg.src, tokenRef.current).then((url) =>
            send(url ? { type: "imageResolved", src: msg.src, url } : { type: "imageFailed", src: msg.src }),
          );
          break;
        case "error":
          toast(msg.message, "danger");
          break;
        default:
          break;
      }
    },
    [init, send, t],
  );

  // A killed WebView content process (memory pressure) comes back blank;
  // reload it and the `ready` handshake re-initialises from the latest body.
  const revive = useCallback(() => {
    readyRef.current = false;
    setReady(false);
    web.current?.reload();
  }, []);

  return (
    <View style={[styles.fill, { backgroundColor: p.bg }, props.style]}>
      <WebView
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        ref={web}
        source={SOURCE}
        originWhitelist={["*"]}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={allowOnlyThePage}
        setSupportMultipleWindows={false}
        javaScriptEnabled
        domStorageEnabled={false}
        // The page draws its own ground; transparent avoids a white flash
        // before the theme arrives.
        style={[styles.fill, { backgroundColor: "transparent", opacity: ready ? 1 : 0 }]}
        containerStyle={{ backgroundColor: p.bg }}
        // iOS: our toolbar replaces the form accessory bar; focus() from RN
        // (a new note) must be allowed to raise the keyboard.
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction={false}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        allowsLinkPreview={false}
        dataDetectorTypes="none"
        // Android: the reading size setting, not the system font scale, sizes the note.
        textZoom={100}
        overScrollMode="content"
        nestedScrollEnabled
        webviewDebuggingEnabled={__DEV__}
        onContentProcessDidTerminate={revive}
        onRenderProcessGone={revive}
        {...(Platform.OS === "android" ? { androidLayerType: "hardware" as const } : null)}
      />
    </View>
  );
});

/** The page is loaded from a string; it must never navigate anywhere. */
function allowOnlyThePage(request: ShouldStartLoadRequest): boolean {
  const url = request.url ?? "";
  if (url === "about:blank" || url.startsWith("about:") || url.startsWith("data:")) return true;
  if (/^(https?|mailto|tel):/i.test(url)) void Linking.openURL(url).catch(() => {});
  return false;
}

function openLink(href: string, failure: string) {
  const target = href.trim();
  if (!/^(https?|mailto|tel):/i.test(target)) {
    toast(failure, "danger");
    return;
  }
  Linking.openURL(target).catch(() => toast(failure, "danger"));
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
