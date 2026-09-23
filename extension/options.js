import { getSettings, saveSettings, DEFAULT_BASE } from "./api.js";
import { signOut, clearSession, normBase } from "./oauth.js";

const $ = (id) => document.getElementById(id);
let revealed = false;

function mask(token) {
  if (!token) return "";
  return `${token.slice(0, 8)}${"•".repeat(24)}${token.slice(-6)}`;
}

async function renderAuth() {
  const { accessToken, tokenExpiresAt, tokenBase } = await chrome.storage.local.get([
    "accessToken", "tokenExpiresAt", "tokenBase",
  ]);
  const signedIn = !!accessToken;

  $("authState").textContent = signedIn ? `Connected${tokenBase ? ` to ${new URL(tokenBase).host}` : ""}.` : "Not connected.";
  $("authState").className = "zk-muted";
  $("signInBtn").hidden = signedIn;
  $("signOutBtn").hidden = !signedIn;
  $("tokenCard").hidden = !signedIn;

  if (signedIn) {
    $("tokenValue").textContent = revealed ? accessToken : mask(accessToken);
    $("revealBtn").textContent = revealed ? "Hide" : "Show";
    $("tokenMeta").textContent = tokenExpiresAt
      ? `Expires ${new Date(tokenExpiresAt).toLocaleString()} (renewed automatically).`
      : "No expiry reported.";
  }
}

/** A non-default API base needs a host grant (optional_host_permissions). */
async function ensureHostPermission(base) {
  if (normBase(base) === DEFAULT_BASE) return true;
  const origins = [`${new URL(base).origin}/*`];
  if (await chrome.permissions.contains({ origins })) return true;
  return chrome.permissions.request({ origins });
}

function readBase() {
  const raw = ($("apiBase").value || DEFAULT_BASE).trim();
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.hostname !== "localhost") return null;
    return normBase(u.origin);
  } catch {
    return null;
  }
}

async function init() {
  const settings = await getSettings();
  $("apiBase").value = settings.apiBase || DEFAULT_BASE;
  $("agentId").value = settings.agentId || "extension";

  $("saveBtn").addEventListener("click", async () => {
    const base = readBase();
    if (!base) {
      $("status").textContent = "Enter an https:// URL (or http://localhost).";
      return;
    }
    if (!(await ensureHostPermission(base))) {
      $("status").textContent = `Chrome did not grant access to ${new URL(base).host}.`;
      return;
    }
    const { tokenBase } = await chrome.storage.local.get(["tokenBase"]);
    await saveSettings({ apiBase: base, agentId: $("agentId").value.trim() || "extension" });
    // A token is only valid for the server that issued it.
    if (tokenBase && tokenBase !== base) await clearSession();
    await chrome.storage.local.remove(["brainsCache"]);
    $("apiBase").value = base;
    $("status").textContent = "Saved.";
    setTimeout(() => ($("status").textContent = ""), 1600);
    await renderAuth();
  });

  $("signInBtn").addEventListener("click", async () => {
    const base = readBase();
    if (!base) {
      $("authState").textContent = "Enter a valid API base URL first.";
      return;
    }
    if (!(await ensureHostPermission(base))) {
      $("authState").textContent = `Chrome did not grant access to ${new URL(base).host}.`;
      return;
    }
    $("signInBtn").disabled = true;
    $("authState").textContent = "Opening Zekra… finish signing in in the new window.";
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: "zekra:signIn", apiBase: base });
    } catch (e) {
      res = { ok: false, error: e?.message || String(e) };
    }
    $("signInBtn").disabled = false;
    revealed = false;
    if (res?.ok) {
      $("apiBase").value = base;
      await renderAuth();
    } else {
      $("authState").textContent = res?.error || "Sign-in failed.";
      $("authState").className = "zk-error";
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

  // Stay in sync with sign-in/out finishing in the worker or popup.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes.accessToken || changes.tokenExpiresAt)) renderAuth();
  });

  await renderAuth();
}

init();
