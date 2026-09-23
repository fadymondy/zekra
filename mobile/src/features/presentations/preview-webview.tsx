import { useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";

import { ErrorLine, Spinner, TextButton } from "@/components/kit";
import { useI18n } from "@/lib/i18n";
import { usePalette } from "@/theme";

/*
The public share page in a WebView. Loaded lazily by preview-modal.tsx: the
react-native-webview module resolves its native half at import time and
throws on a build that predates it, so it is never imported eagerly.
*/
export default function PreviewWebView({ url, onOpenExternal }: { url: string; onOpenExternal: () => void }) {
  const p = usePalette();
  const { t } = useI18n();
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  if (failed) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 28 }}>
        <ErrorLine text={t("presentations.preview.failed")} />
        <TextButton label={t("kit.retry")} onPress={() => { setFailed(null); setAttempt((n) => n + 1); }} />
        <TextButton label={t("presentations.share.open")} onPress={onOpenExternal} />
      </View>
    );
  }
  return (
    <WebView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
      key={`${url}#${attempt}`}
      source={{ uri: url }}
      style={{ flex: 1, backgroundColor: p.bg }}
      startInLoadingState
      renderLoading={() => (
        <View style={{ position: "absolute", top: 0, bottom: 0, start: 0, end: 0, alignItems: "center", justifyContent: "center", backgroundColor: p.bg }}>
          <Spinner size="large" />
        </View>
      )}
      onError={(e) => setFailed(e.nativeEvent.description || "error")}
      onHttpError={(e) => setFailed(String(e.nativeEvent.statusCode))}
      allowsInlineMediaPlayback
      allowsBackForwardNavigationGestures
      setSupportMultipleWindows={false}
      pullToRefreshEnabled
    />
  );
}
