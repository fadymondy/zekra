import "react-native-gesture-handler";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { I18nProvider } from "@/lib/i18n";
import { AuthProvider, useAuth } from "@/providers/auth";
import { BrainProvider } from "@/providers/brains";
import { ThemeProvider, useTheme } from "@/theme";

// Hold the native splash until the stored session has been restored, so the
// app never flashes the sign-in screen at an already-signed-in user.
void SplashScreen.preventAutoHideAsync();

function Shell() {
  const { ready } = useAuth();
  // Lusail carries both Arabic and Latin, so the whole UI uses one family.
  const [fontsLoaded] = useFonts({
    "Lusail-Light": require("../assets/fonts/Lusail-Light.ttf"),
    "Lusail-Regular": require("../assets/fonts/Lusail-Regular.ttf"),
    "Lusail-Medium": require("../assets/fonts/Lusail-Medium.ttf"),
    "Lusail-Bold": require("../assets/fonts/Lusail-Bold.ttf"),
  });
  const { scheme } = useTheme();
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (ready && fontsLoaded && !hidden) {
      setHidden(true);
      void SplashScreen.hideAsync().catch(() => {});
    }
  }, [ready, fontsLoaded, hidden]);

  return (
    <>
      <StatusBar style={scheme === "dark" ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="account/profile" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="account/password" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="account/delete" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="legal/[doc]" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="note/[id]" options={{ presentation: "card", animation: "slide_from_right" }} />
      </Stack>
    </>
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
                <Shell />
              </BrainProvider>
            </AuthProvider>
          </I18nProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
