// Popup: render instantly from local state, then refresh in the background.
//
//  1. One storage read decides the view (signed in / out) and fills the brain
//     picker from the cached list — no network before first paint.
//  2. The page title/URL come from chrome.tabs (instant); the selection is read
//     with injectImmediately and a short timeout, so a still-loading page can
//     never stall the popup.
//  3. The brain list is refreshed in the background; a dead session flips the
//     popup to "Connect" instead of leaving an error with no way out.
//  4. Sign-in and saves run in the service worker, which outlives the popup.

import { getSettings, listMyBrains, createNote, putSecret, ApiError } from "./api.js";

const $ = (id) => document.getElementById(id);

function say(el, msg, kind = "muted") {
  el.textContent = msg || "";
  el.className = kind === "error" ? "zk-error" : kind === "success" ? "zk-success" : "zk-muted";
}

const state = { activeUrl: "", signedIn: false, brainsLoaded: false, refreshing: null };

// ---------------------------------------------------------------------------
// Service-worker messaging (falls back to running in-page if the worker is
// unavailable, e.g. the plain-browser preview).
// ---------------------------------------------------------------------------

async function toWorker(message, fallback) {
  try {
    const res = await chrome.runtime.sendMessage(message);
    if (res) return res;
  } catch {
    // no worker listening
  }
  if (!fallback) return { ok: false, error: "The extension's background worker is not running. Reload the extension." };
  try {
    await fallback();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e), signedOut: !!e?.signedOut };
  }
}

// ---------------------------------------------------------------------------
// Page info
// ---------------------------------------------------------------------------

function composeBody({ url, selection }) {
  const parts = [];
  if (selection) parts.push(selection.trim());
  if (url) parts.push(`Source: ${url}`);
  return parts.join("\n\n");
}

async function readSelection(tabId) {
  try {
    const run = chrome.scripting.executeScript({
      target: { tabId },
      // Default injection waits for document_idle — on a heavy page that is still
      // loading, that held the whole popup blank. Selection is readable now.
      injectImmediately: true,
      func: () => window.getSelection?.().toString() ?? "",
    });
    const timeout = new Promise((resolve) => setTimeout(() => resolve([]), 800));
    const [{ result } = {}] = await Promise.race([run, timeout]);
    return result || "";
  } catch {
    return ""; // Restricted page (chrome://, Web Store, etc.) — no selection, that is fine.
  }
}

async function fillFromPage(pending) {
  if (pending) {
    state.activeUrl = pending.url || "";
    $("titleInput").value = pending.title || "";
    $("bodyInput").value = composeBody(pending);
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  // Title/URL first (instant), selection after.
  state.activeUrl = tab.url || "";
  $("titleInput").value = tab.title || "";
  $("bodyInput").value = composeBody({ url: tab.url || "" });
  if (!tab.id) return;
  const selection = await readSelection(tab.id);
  if (selection && state.activeUrl === (tab.url || "")) {
    $("bodyInput").value = composeBody({ url: tab.url || "", selection });
  }
}

// ---------------------------------------------------------------------------
// Brains
// ---------------------------------------------------------------------------

function renderBrains(brains, preferred) {
  const select = $("brainSelect");
  const vaultSelect = $("vaultBrainSelect");
  const keep = select.value || preferred;
  const keepVault = vaultSelect.value || preferred;
  const writable = brains.filter((b) => b.canWrite !== false);
  const list = writable.length ? writable : brains;

  const frag = document.createDocumentFragment();
  for (const b of list) {
    const opt = document.createElement("option");
    opt.value = b.namespace;
    opt.textContent = b.role ? `${b.namespace} (${b.role})` : b.namespace;
    frag.appendChild(opt);
  }
  const vaultFrag = frag.cloneNode(true);
  select.replaceChildren(frag);
  vaultSelect.replaceChildren(vaultFrag);
  if (keep && list.some((b) => b.namespace === keep)) select.value = keep;
  if (keepVault && list.some((b) => b.namespace === keepVault)) vaultSelect.value = keepVault;
  state.brainsLoaded = list.length > 0;
  return list.length;
}

function renderBrainsPlaceholder(text) {
  for (const id of ["brainSelect", "vaultBrainSelect"]) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = text;
    opt.disabled = true;
    opt.selected = true;
    $(id).replaceChildren(opt);
  }
}

async function refreshBrains(preferred) {
  if (state.refreshing) return state.refreshing;
  const note = $("brainsStatus");
  if (!state.brainsLoaded) say(note, "Loading your brains…");
  state.refreshing = (async () => {
    try {
      const { brains = [] } = await listMyBrains();
      const n = renderBrains(brains, preferred);
      say(note, n ? "" : "This connection has no writable brains. Reconnect and tick a brain with write access.", n ? "muted" : "error");
    } catch (e) {
      if (e?.signedOut) {
        showSignedOut(e.message);
        return;
      }
      // Keep the cached list usable; just say the refresh failed.
      const msg = e instanceof ApiError ? e.message : String(e);
      say(note, state.brainsLoaded ? `Could not refresh brains: ${msg}` : msg, "error");
      if (!state.brainsLoaded) renderBrainsPlaceholder("No brains loaded");
    } finally {
      state.refreshing = null;
    }
  })();
  return state.refreshing;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

function showTab(tab) {
  const note = tab === "note";
  $("captureForm").hidden = !note;
  $("vaultForm").hidden = note;
  $("tabNote").className = note ? "zk-tab zk-tab-active" : "zk-tab";
  $("tabVault").className = note ? "zk-tab" : "zk-tab zk-tab-active";
}

function showSignedOut(message, kind = "error") {
  state.signedIn = false;
  state.brainsLoaded = false;
  $("signedOut").hidden = false;
  $("tabs").hidden = true;
  $("captureForm").hidden = true;
  $("vaultForm").hidden = true;
  if (message) say($("authStatus"), message, kind);
}

function showSignedIn(cache, preferred) {
  state.signedIn = true;
  $("signedOut").hidden = true;
  $("tabs").hidden = false;
  showTab("note");
  if (cache?.brains?.length) renderBrains(cache.brains, preferred);
  // No cached list yet, but we know the brain used last: offer it right away
  // (the background refresh replaces it with the real list).
  else if (preferred) renderBrains([{ namespace: preferred }], preferred);
  else renderBrainsPlaceholder("Loading brains…");
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function onSignIn() {
  const btn = $("signInBtn");
  btn.disabled = true;
  say($("authStatus"), "Opening Zekra… finish signing in in the new window. This popup may close; reopen it when you are done.");
  const { apiBase } = await getSettings();
  const res = await toWorker({ type: "zekra:signIn", apiBase });
  // Only reached if the popup survived the sign-in window.
  btn.disabled = false;
  if (!res.ok) say($("authStatus"), res.error, "error");
}

async function onSaveNote() {
  const namespace = $("brainSelect").value;
  if (!namespace) return say($("status"), state.brainsLoaded ? "Pick a brain first." : "Brains are still loading — try again in a moment.", "error");
  const note = {
    namespace,
    title: $("titleInput").value.trim(),
    body: $("bodyInput").value.trim(),
    tags: $("tagsInput").value.split(",").map((t) => t.trim()).filter(Boolean),
    url: state.activeUrl,
  };
  $("saveBtn").disabled = true;
  say($("status"), "Saving… (you can close this popup — the save continues in the background)");
  const res = await toWorker({ type: "zekra:saveNote", note }, () => createNote(note));
  $("saveBtn").disabled = false;
  if (res.ok) say($("status"), `Saved to ${namespace}.`, "success");
  else if (res.signedOut) showSignedOut(res.error);
  else say($("status"), res.error, "error");
}

async function onSaveSecret() {
  const namespace = $("vaultBrainSelect").value;
  const name = $("secretName").value.trim();
  const value = $("secretValue").value;
  const status = $("vaultStatus");
  if (!namespace) return say(status, "Pick a brain first.", "error");
  if (!name || !value) return say(status, "Name and value are both required.", "error");

  $("saveSecretBtn").disabled = true;
  say(status, "Saving…");
  const secret = { namespace, name, value };
  const res = await toWorker({ type: "zekra:saveSecret", secret }, () => putSecret(secret));
  $("saveSecretBtn").disabled = false;
  if (res.ok) {
    $("secretName").value = "";
    $("secretValue").value = "";
    say(status, `Saved "${name}" to ${namespace}.`, "success");
  } else if (res.signedOut) {
    showSignedOut(res.error);
  } else {
    say(status, res.error, "error");
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function wire() {
  $("optionsLink").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  $("tabNote").addEventListener("click", () => showTab("note"));
  $("tabVault").addEventListener("click", () => showTab("vault"));
  $("signInBtn").addEventListener("click", onSignIn);
  $("refreshBtn").addEventListener("click", () => fillFromPage());
  $("saveBtn").addEventListener("click", onSaveNote);
  $("saveSecretBtn").addEventListener("click", onSaveSecret);
}

async function init() {
  wire(); // every control works from the first frame, in every state

  const [local, session, settings] = await Promise.all([
    chrome.storage.local.get(["accessToken", "brainsCache"]),
    chrome.storage.session?.get(["pendingCapture", "signInPending", "signInError"]).catch(() => ({})) ?? {},
    getSettings(),
  ]);
  $("baseLabel").textContent = new URL(settings.apiBase).host;

  const pending = session.pendingCapture;
  if (pending) chrome.storage.session.remove("pendingCapture");

  if (local.accessToken) {
    const cache = local.brainsCache?.base === settings.apiBase ? local.brainsCache : null;
    showSignedIn(cache, settings.namespace);
    fillFromPage(pending);
    refreshBrains(settings.namespace);
  } else if (session.signInPending && Date.now() - session.signInPending < 90_000) {
    showSignedOut("Sign-in is in progress in the Zekra window — finish there, then reopen this popup.", "muted");
  } else {
    showSignedOut(session.signInError || "", "error");
    if (pending) fillFromPage(pending); // kept for after sign-in
  }

  // React to sign-in / sign-out finishing elsewhere (worker, options page).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes.accessToken) return;
    if (changes.accessToken.newValue && !state.signedIn) {
      say($("authStatus"), "");
      showSignedIn(null, settings.namespace);
      fillFromPage(pending);
      refreshBrains(settings.namespace);
    } else if (!changes.accessToken.newValue && state.signedIn) {
      showSignedOut("Disconnected.", "muted");
    }
  });
}

init();
