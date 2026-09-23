// Home-screen widgets (MH-360). Entry points:
//   useWidgetSync()               — mount once in app/_layout.tsx (Shell)
//   syncWidgets(data)             — push data you already have to the widgets
//   refreshWidgetsInBackground()  — FCM background handler (headless-safe;
//                                   import it from "@/features/widgets/sync")
//   registerWidgets()             — index.js, Android widget task (headless-safe;
//                                   import it from "./src/features/widgets/register")
// The headless entry points are imported from their own files there, so the
// entry does not pull this barrel's React / router dependencies.
export { useWidgetSync } from "./use-widget-sync";
export { refreshWidgetsInBackground, syncWidgets } from "./sync";
export { registerWidgets } from "./register";
export type { WidgetSnapshot, WidgetSourceData } from "./widgets-core";
