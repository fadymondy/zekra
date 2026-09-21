// MV3 service worker: wires a right-click "Save selection to Zekra" context menu
// item and the Ctrl+Shift+Z shortcut to a quick-capture note, and keeps the
// captured selection in session storage so the popup can pick it up if the user
// opens it instead (Chrome does not let a service worker open the action popup
// programmatically with data pre-filled, only chrome.action.openPopup()).

import { getSettings, createNote, ApiError } from "./api.js";
import { isSignedIn } from "./oauth.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "zekra-save-selection",
    title: "Save selection to Zekra",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: "zekra-save-page",
    title: "Save page to Zekra",
    contexts: ["page"],
  });
});

async function quickCapture(tab, selectionText) {
  const settings = await getSettings();
  if (!(await isSignedIn()) || !settings.namespace) {
    // Nothing configured yet (no default brain) — fall back to opening the popup
    // so the user can pick a brain and confirm before we write anything.
    await chrome.storage.session.set({
      pendingCapture: { title: tab?.title || "", url: tab?.url || "", selection: selectionText || "" },
    });
    chrome.action.openPopup?.();
    return;
  }
  const body = [selectionText?.trim(), tab?.url ? `Source: ${tab.url}` : ""].filter(Boolean).join("\n\n");
  try {
    await createNote({ namespace: settings.namespace, title: tab?.title || "", body, url: tab?.url || "" });
    chrome.action.setBadgeText({ text: "OK" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 1500);
  } catch (e) {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#b3261e" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 2000);
    console.error("Zekra capture failed", e instanceof ApiError ? e.message : e);
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "zekra-save-selection") {
    quickCapture(tab, info.selectionText || "");
  } else if (info.menuItemId === "zekra-save-page") {
    quickCapture(tab, "");
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "capture-selection") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  let selection = "";
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection?.().toString() ?? "",
    });
    selection = result || "";
  } catch {
    // restricted page
  }
  quickCapture(tab, selection);
});
