import { ExternalLink, X } from "lucide-react-native";
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Modal, StyleSheet, TurboModuleRegistry, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AwaitNote, Spinner, TextButton } from "@/components/kit";
import { AppText, IconButton, Segmented } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { fonts, metrics, usePalette } from "@/theme";

import { openInBrowser } from "./files";
import { shareUrlForLocale } from "./presentations-core";
import type { PLocale } from "./types";

const PreviewWebView = lazy(() => import("./preview-webview"));

/** Whether this build carries react-native-webview's native module. */
function hasWebView(): boolean {
  try {
    return TurboModuleRegistry.get("RNCWebViewModule") != null;
  } catch {
    return false;
  }
}

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * The rendered presentation, full screen: the public share page (the same
 * one the customer sees) in a WebView, with a language switch when the
 * document has both. Switching language swaps the /{locale}/ path segment.
 */
export function PreviewModal({ open, onClose, url, title, locales, initialLocale }: {
  open: boolean;
  onClose: () => void;
  /** Any known share URL of the document; "" while one is being made. */
  url: string;
  title: string;
  locales: PLocale[];
  initialLocale: PLocale;
}) {
  const p = usePalette();
  const { t, isRtl } = useI18n();
  const insets = useSafeAreaInsets();
  const [loc, setLoc] = useState<PLocale>(initialLocale);
  useEffect(() => {
    if (open) setLoc(initialLocale);
  }, [open, initialLocale]);

  const shown = url ? shareUrlForLocale(url, loc) : "";
  const external = () => {
    if (shown) void openInBrowser(shown);
  };
  const fallback = (
    <View style={styles.center}>
      <AwaitNote text={t("presentations.preview.unavailable")} />
      {shown ? <TextButton label={t("presentations.share.open")} onPress={external} /> : null}
    </View>
  );

  return (
    <Modal visible={open} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: p.bg, direction: isRtl ? "rtl" : "ltr", paddingTop: insets.top }}>
        <View style={[styles.bar, { borderBottomColor: p.line }]}>
          <IconButton label={t("common.close")} onPress={onClose}>
            <X size={20} color={p.muted} strokeWidth={1.6} />
          </IconButton>
          <View style={{ flex: 1, gap: 2 }}>
            <AppText numberOfLines={1} style={{ fontFamily: fonts.semibold, fontSize: 16, color: p.ink }}>{title}</AppText>
            <AppText variant="micro" numberOfLines={1}>{t("presentations.preview.title").toUpperCase()}</AppText>
          </View>
          <IconButton label={t("presentations.share.open")} onPress={external} disabled={!shown}>
            <ExternalLink size={18} color={p.muted} strokeWidth={1.6} />
          </IconButton>
        </View>
        {locales.length > 1 ? (
          <View style={[styles.langs, { borderBottomColor: p.line }]}>
            <Segmented<PLocale>
              value={loc}
              onChange={setLoc}
              options={locales.map((l) => ({ value: l, label: t(`presentations.locale.${l}`) }))}
            />
          </View>
        ) : null}
        <View style={{ flex: 1, paddingBottom: insets.bottom }}>
          {!shown ? (
            <View style={styles.center}><Spinner size="large" /></View>
          ) : !hasWebView() ? (
            fallback
          ) : (
            <Boundary fallback={fallback}>
              <Suspense fallback={<View style={styles.center}><Spinner size="large" /></View>}>
                <PreviewWebView url={shown} onOpenExternal={external} />
              </Suspense>
            </Boundary>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  bar: { minHeight: 64, paddingVertical: 10, paddingHorizontal: metrics.padX - 12, borderBottomWidth: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  langs: { paddingHorizontal: metrics.padX, paddingVertical: 10, borderBottomWidth: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: metrics.padX },
});
