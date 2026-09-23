import { Stack } from "expo-router";

// The Brains tab's own stack: a brain, its notes and presentations, and the
// notification center are pushed here, so the tab bar stays on screen inside
// them (as in Apple's apps). URLs are unchanged — the group adds no segment:
// /brains, /brain/<ns>, /note/<id>, /presentation/<id>, /notifications.
export const unstable_settings = { initialRouteName: "brains" };

export default function BrainsStack() {
  return <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }} />;
}
