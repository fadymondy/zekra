import { decodeToEngine, encode, type FromEngine, type ToEngine } from "../src/features/editor/bridge-core.ts";

/*
The page half of the RN bridge. RN delivers by injecting
`window.__zk.receive("<json>")` (see bridge-core injectionFor); the page
answers through react-native-webview's window.ReactNativeWebView.postMessage.

Outside a WebView (the headless smoke test, a desktop browser while
debugging) there is no ReactNativeWebView, so outgoing messages are kept on
window.__zkOutbox instead of being dropped.
*/

declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(message: string): void };
    __zk?: { receive(raw: unknown): void };
    __zkOutbox?: FromEngine[];
  }
}

export function post(msg: FromEngine): void {
  if (window.ReactNativeWebView) {
    window.ReactNativeWebView.postMessage(encode(msg));
  } else {
    (window.__zkOutbox ??= []).push(msg);
  }
}

export function listen(handler: (msg: ToEngine) => void | Promise<void>): void {
  window.__zk = {
    receive(raw) {
      const msg = decodeToEngine(raw);
      if (!msg) return;
      try {
        const out = handler(msg);
        if (out && typeof (out as Promise<void>).catch === "function") {
          (out as Promise<void>).catch((e: unknown) => post({ type: "error", message: errorText(e) }));
        }
      } catch (e) {
        post({ type: "error", message: errorText(e) });
      }
    },
  };
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Trailing-edge debounce with an explicit flush (blur must not wait). */
export function debounced(fn: () => void, ms: number): { schedule(): void; flush(): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, ms);
    },
    flush() {
      if (!timer) return;
      clearTimeout(timer);
      timer = null;
      fn();
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
