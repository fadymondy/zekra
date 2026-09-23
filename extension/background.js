// MV3 service worker.
//
//  - Right-click "Save selection/page to Zekra" and Ctrl/Cmd+Shift+Z quick-capture.
//  - Runs the OAuth sign-in on behalf of the popup/options page. The popup is
//    destroyed the moment the sign-in window takes focus, so a sign-in started
//    there never reached the code exchange; here it survives.
//  - Performs saves for the popup, so closing the popup mid-save (a retain can
//    take a few seconds: embedding + write decision) does not lose the note.
//
// All listeners are registered synchronously at top level (MV3 requirement: a
// worker woken by an event must find its listener on the first turn). No state
// is kept in globals across events except the in-flight sign-in promise.

import { getSettings, saveSettings, createNote, putSecret, ApiError } from "./api.js";
import { signIn, signOut, isSignedIn } from "./oauth.js";

const MENU_SELECTION = "zekra-save-selection";
const MENU_PAGE = "zekra-save-page";

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_SELECTION, title: "Save selection to Zekra", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MENU_PAGE, title: "Save page to Zekra", contexts: ["page"] });
  });
}

chrome.runtime.onInstalled.addListener(createMenus);

// ---------------------------------------------------------------------------
// Badge feedback
// ---------------------------------------------------------------------------

let badgeTimer;
function badge(text, color, clearAfterMs = 0) {
  clearTimeout(badgeTimer);
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
  if (clearAfterMs) badgeTimer = setTimeout(() => chrome.action.setBadgeText({ text: "" }), clearAfterMs);
}

function errMessage(e) {
  return e instanceof ApiError || e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// Keep the worker alive while a long user-driven flow is pending (the sign-in
// window can sit open for minutes; an idle worker is stopped after ~30s and
// would drop the code exchange). Any extension API call resets the idle timer.
// ---------------------------------------------------------------------------

async function keepAliveWhile(promise, maxMs = 10 * 60_000) {
  const until = Date.now() + maxMs;
  const t = setInterval(() => {
    if (Date.now() > until) return clearInterval(t);
    chrome.runtime.getPlatformInfo(() => {});
  }, 20_000);
  try {
    return await promise;
  } finally {
    clearInterval(t);
  }
}

let signInFlight = null;
let signInStarted = 0;
function runSignIn(apiBase) {
  // A second click joins the pending sign-in, unless it looks abandoned (Chrome
  // rejects the flow when its window is closed, but a promise that might never
  // settle must not gate the only way back in).
  if (signInFlight && Date.now() - signInStarted < 90_000) return signInFlight;
  signInStarted = Date.now();
  // The popup reads this to say "finish in the Zekra window" if reopened.
  chrome.storage.session.set({ signInPending: signInStarted, signInError: "" });
  const flight = keepAliveWhile(signIn(apiBase))
    .then(() => {
      // The popup closed when the sign-in window opened: bring it back.
      Promise.resolve().then(() => chrome.action.openPopup()).catch(() => {});
      return { ok: true };
    })
    .catch((e) => {
      chrome.storage.session.set({ signInError: errMessage(e) });
      return { ok: false, error: errMessage(e) };
    })
    .finally(() => {
      if (signInFlight !== flight) return; // superseded by a newer attempt
      chrome.storage.session.remove("signInPending");
      signInFlight = null;
    });
  signInFlight = flight;
  return flight;
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

async function saveNote(note) {
  badge("…", "#6d4de6");
  try {
    await createNote(note);
    await saveSettings({ namespace: note.namespace });
    badge("OK", "#4e9a3e", 1500);
    return { ok: true };
  } catch (e) {
    badge("!", "#d9455f", 4000);
    console.warn("Zekra save failed:", errMessage(e));
    return { ok: false, error: errMessage(e), signedOut: !!e?.signedOut };
  }
}

async function openPopupOrWindow() {
  try {
    await chrome.action.openPopup();
    return;
  } catch {
    // Not allowed here (no focused window / older Chrome): use a small window.
  }
  try {
    await chrome.windows.create({ url: chrome.runtime.getURL("popup.html"), type: "popup", width: 380, height: 640 });
  } catch (e) {
    console.warn("Zekra: could not open the popup", e);
  }
}

async function quickCapture(tab, selectionText) {
  const [settings, signedIn] = await Promise.all([getSettings(), isSignedIn()]);
  if (!signedIn || !settings.namespace) {
    // Nothing configured yet (no default brain) — hand the capture to the popup
    // so the user can pick a brain and confirm before we write anything.
    await chrome.storage.session.set({
      pendingCapture: { title: tab?.title || "", url: tab?.url || "", selection: selectionText || "" },
    });
    await openPopupOrWindow();
    return;
  }
  const body = [selectionText?.trim(), tab?.url ? `Source: ${tab.url}` : ""].filter(Boolean).join("\n\n");
  await saveNote({ namespace: settings.namespace, title: tab?.title || "", body, url: tab?.url || "" });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_SELECTION) {
    quickCapture(tab, info.selectionText || "");
  } else if (info.menuItemId === MENU_PAGE) {
    quickCapture(tab, "");
  }
});

async function readSelection(tabId) {
  try {
    const run = chrome.scripting.executeScript({
      target: { tabId },
      // Do not wait for the page to finish loading (default is document_idle,
      // which stalls for as long as a heavy page keeps loading).
      injectImmediately: true,
      func: () => window.getSelection?.().toString() ?? "",
    });
    const timeout = new Promise((resolve) => setTimeout(() => resolve([]), 1500));
    const [{ result } = {}] = await Promise.race([run, timeout]);
    return result || "";
  } catch {
    return ""; // restricted page (chrome://, Web Store, PDF viewer, ...)
  }
}

chrome.commands.onCommand.addListener(async (command, commandTab) => {
  if (command !== "capture-selection") return;
  const tab = commandTab?.id ? commandTab : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.id) return;
  quickCapture(tab, await readSelection(tab.id));
});

// ---------------------------------------------------------------------------
// Messages from the popup / options page
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== "string") return false;
  let work;
  switch (msg.type) {
    case "zekra:signIn":
      work = runSignIn(msg.apiBase);
      break;
    case "zekra:signOut":
      work = signOut().then(() => ({ ok: true }));
      break;
    case "zekra:saveNote":
      work = saveNote(msg.note);
      break;
    case "zekra:saveSecret":
      work = putSecret(msg.secret).then(
        () => ({ ok: true }),
        (e) => ({ ok: false, error: errMessage(e), signedOut: !!e?.signedOut }),
      );
      break;
    default:
      return false;
  }
  work.then(sendResponse, (e) => sendResponse({ ok: false, error: errMessage(e) }));
  return true; // async response
});
