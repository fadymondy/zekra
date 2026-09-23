import "react-native-gesture-handler";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Inter_300Light, Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from "@expo-google-fonts/inter";
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { ToastHost } from "@/components/kit";
import { ExportHost } from "@/features/editor/export-host";
import { MahaamReportHost } from "@/features/mahaam";
import { PushBannerHost, usePushNotifications } from "@/features/push";
import { AppLockGate } from "@/features/security/app-lock-gate";
import { useWidgetSync } from "@/features/widgets";
import { useScreenTracking } from "@/lib/analytics";
import { initCrashReporting } from "@/lib/crash";
import { AnimatedSplash } from "@/features/splash/animated-splash";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { AuthProvider, useAuth } from "@/providers/auth";
import { BrainProvider } from "@/providers/brains";
import { ReadingProvider } from "@/providers/reading";
import { ThemeProvider, useTheme } from "@/theme";

// Hold the native splash until the stored session has been restored, so the
// app never flashes the sign-in screen at an already-signed-in user.
void SplashScreen.preventAutoHideAsync();

// Crash reporting starts before anything renders; the router's ErrorBoundary
// reports render errors (both no-ops in builds without Firebase config).
initCrashReporting();
export { ErrorBoundary } from "@/lib/crash";

function Shell() {
  const { ready, token } = useAuth();
  useScreenTracking();
  usePushNotifications(token);
  useWidgetSync();
  // Lusail carries both Arabic and Latin, so the whole UI uses one family.
  const [fontsLoaded] = useFonts({
    "Lusail-Light": require("../assets/fonts/Lusail-Light.ttf"),
    "Lusail-Regular": require("../assets/fonts/Lusail-Regular.ttf"),
    "Lusail-Medium": require("../assets/fonts/Lusail-Medium.ttf"),
    "Lusail-Bold": require("../assets/fonts/Lusail-Bold.ttf"),
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    Inter_300Light,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });
  const { scheme, palette } = useTheme();
  const { isRtl } = useI18n();
  const [splashDone, setSplashDone] = useState(false);
  const onSplashDone = useCallback(() => setSplashDone(true), []);

  // The native splash hands over to the animated one (same ground colour) as
  // soon as the JS is running; the animated one leaves once the session and
  // fonts are ready.
  useEffect(() => {
    void SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    // The root sets the layout direction for everything, tab bar included, so
    // switching language mirrors the app at once without a reload.
    <View style={{ flex: 1, backgroundColor: palette.bg, direction: isRtl ? "rtl" : "ltr" }}>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="(tabs)" />
      </Stack>
      <ToastHost />
      {/* Report a problem / Send feedback → Zekra's Mahaam board (Settings → About, crash panel). */}
      <MahaamReportHost />
      <PushBannerHost />
      <ExportHost />
      {/* Biometric app lock: over the app and its banners, under the splash. */}
      <AppLockGate />
      {!splashDone ? <AnimatedSplash ready={ready && fontsLoaded} onDone={onSplashDone} /> : null}
    </View>
  );
}

export default function RootLayout() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnReconnect: true } } }));
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={client}>
        <ThemeProvider>
          <I18nProvider>
            <AuthProvider>
              <BrainProvider>
                <ReadingProvider>
                  <Shell />
                </ReadingProvider>
              </BrainProvider>
            </AuthProvider>
          </I18nProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
