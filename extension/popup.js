import { getSettings, saveSettings, listMyBrains, createNote, putSecret, ApiError } from "./api.js";
import { signIn, isSignedIn } from "./oauth.js";

const $ = (id) => document.getElementById(id);

function say(el, msg, kind = "muted") {
  el.textContent = msg || "";
  el.className = kind === "error" ? "zk-error" : kind === "success" ? "zk-success" : "zk-muted";
}

async function getActivePageInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return { title: "", url: "", selection: "" };
  let selection = "";
  try {
    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection?.().toString() ?? "",
    });
    selection = result || "";
  } catch {
    // Restricted page (chrome://, Web Store, etc.) — no selection, that is fine.
  }
  return { title: tab.title || "", url: tab.url || "", selection };
}

let activeUrl = "";

function composeBody({ url, selection }) {
  const parts = [];
  if (selection) parts.push(selection.trim());
  if (url) parts.push(`Source: ${url}`);
  return parts.join("\n\n");
}

async function loadBrains(preferred) {
  const select = $("brainSelect");
  const vaultSelect = $("vaultBrainSelect");
  select.innerHTML = "";
  vaultSelect.innerHTML = "";
  try {
    const { brains = [] } = await listMyBrains();
    const writable = brains.filter((b) => b.canWrite !== false);
    const list = writable.length ? writable : brains;
    for (const b of list) {
      const opt = document.createElement("option");
      opt.value = b.namespace;
      opt.textContent = b.role ? `${b.namespace} (${b.role})` : b.namespace;
      select.appendChild(opt);
      vaultSelect.appendChild(opt.cloneNode(true));
    }
    if (preferred && list.some((b) => b.namespace === preferred)) {
      select.value = preferred;
      vaultSelect.value = preferred;
    }
    if (!list.length) say($("status"), "This grant has no writable brains.", "error");
  } catch (e) {
    say($("status"), e instanceof ApiError ? e.message : String(e), "error");
  }
}

async function fillFromPage() {
  const { title, url, selection } = await getActivePageInfo();
  activeUrl = url;
  $("titleInput").value = title;
  $("bodyInput").value = composeBody({ url, selection });
}

function showTab(tab) {
  const note = tab === "note";
  $("captureForm").hidden = !note;
  $("vaultForm").hidden = note;
  $("tabNote").className = note ? "zk-tab zk-tab-active" : "zk-tab";
  $("tabVault").className = note ? "zk-tab" : "zk-tab zk-tab-active";
}

async function showSignedIn(settings) {
  $("signedOut").hidden = true;
  $("tabs").hidden = false;
  showTab("note");
  await loadBrains(settings.namespace);
  await fillFromPage();
}

async function init() {
  const settings = await getSettings();
  $("baseLabel").textContent = settings.apiBase;
  $("optionsLink").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  $("tabNote").addEventListener("click", () => showTab("note"));
  $("tabVault").addEventListener("click", () => showTab("vault"));

  if (!(await isSignedIn())) {
    $("signedOut").hidden = false;
    $("signInBtn").addEventListener("click", async () => {
      $("signInBtn").disabled = true;
      say($("authStatus"), "Opening Zekra…");
      try {
        await signIn(settings.apiBase);
        say($("authStatus"), "Connected.", "success");
        await showSignedIn(settings);
      } catch (e) {
        say($("authStatus"), e.message, "error");
      } finally {
        $("signInBtn").disabled = false;
      }
    });
    return;
  }

  await showSignedIn(settings);

  $("refreshBtn").addEventListener("click", fillFromPage);

  $("saveBtn").addEventListener("click", async () => {
    const namespace = $("brainSelect").value;
    if (!namespace) return say($("status"), "Pick a brain first.", "error");

    $("saveBtn").disabled = true;
    say($("status"), "Saving…");
    try {
      await createNote({
        namespace,
        title: $("titleInput").value.trim(),
        body: $("bodyInput").value.trim(),
        tags: $("tagsInput").value.split(",").map((t) => t.trim()).filter(Boolean),
        url: activeUrl,
      });
      await saveSettings({ namespace });
      say($("status"), `Saved to ${namespace}.`, "success");
    } catch (e) {
      say($("status"), e instanceof ApiError ? e.message : String(e), "error");
    } finally {
      $("saveBtn").disabled = false;
    }
  });

  $("saveSecretBtn").addEventListener("click", async () => {
    const namespace = $("vaultBrainSelect").value;
    const name = $("secretName").value.trim();
    const value = $("secretValue").value;
    const status = $("vaultStatus");
    if (!namespace) return say(status, "Pick a brain first.", "error");
    if (!name || !value) return say(status, "Name and value are both required.", "error");

    $("saveSecretBtn").disabled = true;
    say(status, "Saving…");
    try {
      await putSecret({ namespace, name, value });
      $("secretName").value = "";
      $("secretValue").value = "";
      say(status, `Saved "${name}" to ${namespace}.`, "success");
    } catch (e) {
      say(status, e instanceof ApiError ? e.message : String(e), "error");
    } finally {
      $("saveSecretBtn").disabled = false;
    }
  });
}

init();
