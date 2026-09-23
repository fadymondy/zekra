// Browser-preview shim: when popup.html/options.html are opened in a plain
// browser tab (e.g. served over HTTP for a quick visual/remote check)
// instead of loaded as an actual Chrome extension, the `chrome.*` APIs this
// code depends on don't exist. This provides just enough of them — backed by
// localStorage — so the UI renders and can be exercised manually. It never
// runs when actually loaded unpacked in Chrome: the real `chrome` global is
// always defined there first.
//
// Real limitation: chrome.tabs / chrome.scripting have no meaning outside an
// extension (there's no "active tab" to read), so this preview can't pull a
// real page's title/URL/selection — it fills in a placeholder instead.
(function installBrowserShimIfNeeded() {
  if (window.chrome && window.chrome.storage) return;

  const KEY = "zekra-extension-preview-storage";
  function readAll() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
  }
  function writeAll(obj) { localStorage.setItem(KEY, JSON.stringify(obj)); }

  window.chrome = {
    storage: {
      local: {
        async get(keys) {
          const all = readAll();
          if (!keys) return all;
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const k of list) if (k in all) out[k] = all[k];
          return out;
        },
        async set(patch) { writeAll({ ...readAll(), ...patch }); },
        async remove(keys) {
          const all = readAll();
          for (const k of Array.isArray(keys) ? keys : [keys]) delete all[k];
          writeAll(all);
        },
      },
      // In-memory, like the real session area (cleared when the page closes).
      session: (() => {
        const mem = {};
        return {
          async get(keys) {
            const out = {};
            for (const k of Array.isArray(keys) ? keys : [keys]) if (k in mem) out[k] = mem[k];
            return out;
          },
          async set(patch) { Object.assign(mem, patch); },
          async remove(keys) { for (const k of Array.isArray(keys) ? keys : [keys]) delete mem[k]; },
        };
      })(),
      onChanged: { addListener() {} },
    },
    tabs: {
      async query() {
        return [{ id: 0, title: "Zekra web preview (no real tab in a browser)", url: location.href }];
      },
    },
    scripting: {
      async executeScript() {
        return [{ result: "" }];
      },
    },
    runtime: {
      id: "web-preview",
      openOptionsPage() { window.open("options.html", "_blank"); },
      async sendMessage() { throw new Error("No background worker in the web preview."); },
    },
    identity: {
      getRedirectURL() { return location.origin + "/oauth-callback"; },
      async launchWebAuthFlow() {
        throw new Error("OAuth sign-in only works in the real extension, not this web preview.");
      },
    },
    permissions: {
      async contains() { return true; },
      async request() { return true; },
    },
  };

  document.title = `${document.title} (web preview)`;
})();
