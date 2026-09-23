import { Stack } from "expo-router";

// The Account tab's own stack: every settings and account page (and the legal
// documents) is pushed here, so the tab bar stays on screen. URLs are
// unchanged — /settings, /settings/<section>, /account/<page>, /legal/<doc>.
export const unstable_settings = { initialRouteName: "settings" };

export default function AccountStack() {
  return <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }} />;
}
