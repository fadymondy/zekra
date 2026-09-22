// Metro, extended so the app can import the handful of PURE modules it shares
// with the web console (theme palettes, note-settings coercion, the lossy
// markdown check). Those are data and string functions with no imports, so
// sharing them is safe; anything touching the DOM, lucide-react or marked
// stays web-only and is re-implemented here.
//
// Duplicating the 25 theme palettes instead would have been ~325 lines of
// colour values kept in sync by hand, which is exactly the kind of drift the
// desktop re-export was written to avoid.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// Metro only watches the project root by default, so a file outside it is
// "missing" no matter how it is imported.
config.watchFolders = [...(config.watchFolders ?? []), path.join(repoRoot, "web", "lib")];

// Mirrors the tsconfig alias, so an import reads the same to Metro and to tsc.
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  "@shared": path.join(repoRoot, "web", "lib"),
};

// NOT set here, deliberately: nodeModulesPaths pinned to this project plus
// disableHierarchicalLookup. That combination looks like sensible isolation —
// it stops a shared file dragging in a web-only package — but it also stops
// Metro walking nested node_modules, and the bundle immediately failed with
// "Unable to resolve @expo/metro-runtime". Expo relies on that walk.
//
// The isolation it was meant to provide is handled instead by only sharing
// modules that have no imports at all (see the note above).

module.exports = config;
