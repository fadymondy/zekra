import { getSettings, saveSettings, DEFAULT_BASE } from "./api.js";
import { signIn, signOut, isSignedIn } from "./oauth.js";

const $ = (id) => document.getElementById(id);
let revealed = false;

function mask(token) {
  if (!token) return "";
  return `${token.slice(0, 8)}${"•".repeat(24)}${token.slice(-6)}`;
}

async function renderAuth() {
  const signedIn = await isSignedIn();
  const { accessToken, tokenExpiresAt } = await chrome.storage.local.get(["accessToken", "tokenExpiresAt"]);

  $("authState").textContent = signedIn ? "Connected." : "Not connected.";
  $("signInBtn").hidden = signedIn;
  $("signOutBtn").hidden = !signedIn;
  $("tokenCard").hidden = !signedIn;

  if (signedIn && accessToken) {
    $("tokenValue").textContent = revealed ? accessToken : mask(accessToken);
    $("revealBtn").textContent = revealed ? "Hide" : "Show";
    $("tokenMeta").textContent = tokenExpiresAt
      ? `Expires ${new Date(tokenExpiresAt).toLocaleString()}`
      : "No expiry reported.";
  }
}

async function init() {
  const settings = await getSettings();
  $("apiBase").value = settings.apiBase || DEFAULT_BASE;
  $("agentId").value = settings.agentId || "extension";

  $("saveBtn").addEventListener("click", async () => {
    await saveSettings({
      apiBase: ($("apiBase").value || DEFAULT_BASE).replace(/\/$/, ""),
      agentId: $("agentId").value.trim() || "extension",
    });
    $("status").textContent = "Saved.";
    setTimeout(() => ($("status").textContent = ""), 1600);
  });

  $("signInBtn").addEventListener("click", async () => {
    $("signInBtn").disabled = true;
    $("authState").textContent = "Opening Zekra...";
    try {
      await signIn(($("apiBase").value || DEFAULT_BASE).replace(/\/$/, ""));
      revealed = false;
      await renderAuth();
    } catch (e) {
      $("authState").textContent = e.message;
    } finally {
      $("signInBtn").disabled = false;
    }
  });

  $("signOutBtn").addEventListener("click", async () => {
    await signOut();
    revealed = false;
    await renderAuth();
  });

  $("revealBtn").addEventListener("click", async () => {
    revealed = !revealed;
    await renderAuth();
  });

  $("copyBtn").addEventListener("click", async () => {
    const { accessToken } = await chrome.storage.local.get(["accessToken"]);
    if (!accessToken) return;
    await navigator.clipboard.writeText(accessToken);
    $("tokenMeta").textContent = "Copied to clipboard.";
  });

  await renderAuth();
}

init();
