// postinstall: make expo-web-browser 57 find the key window under the UIScene life cycle.
//
// expo-web-browser 57.0.x anchors ASWebAuthenticationSession (and SFSafariViewController) on
// `UIApplication.shared.keyWindow`, which is not scene-aware. This app adopts the UIScene life cycle
// (plugins/with-scene-lifecycle.js — iOS 27 requires it), and there that property can be nil: the
// session then gets a detached ASPresentationAnchor(), never shows, and resolves {type: "cancel"} —
// so "Continue with GitHub/Google" did nothing at all. Expo 58 fixed it upstream
// (SceneGeometry.keyWindow()); until the app is on 58, swap in a scene-aware lookup.
//
// Idempotent, and a no-op (with a note) once the upstream source no longer has the old call.
// Needs a native rebuild to take effect (the files are compiled into the app).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "node_modules", "expo-web-browser", "ios");
const OLD = "UIApplication.shared.keyWindow";
const NEW =
  "/* zekra: scene-aware key window */ (UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene })" +
  ".flatMap({ $0.windows }).first(where: { $0.isKeyWindow }) ?? UIApplication.shared.connectedScenes" +
  ".compactMap({ $0 as? UIWindowScene }).first?.windows.first)";

let patched = 0;
for (const name of ["WebAuthSession.swift", "WebBrowserSession.swift"]) {
  const file = path.join(root, name);
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, "utf8");
  if (!src.includes(OLD)) continue;
  fs.writeFileSync(file, src.split(OLD).join(NEW));
  patched++;
}
if (patched) console.log(`patch-expo-web-browser: scene-aware key window in ${patched} file(s)`);
