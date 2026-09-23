import { bridge } from "../../lib/bridge";
import { lockState } from "./lock-state";

/*
Confirming the Mac's owner (MH-450) — for the app lock and for vault reveals.

macOS prefixes the Touch ID reason with "Zekra is trying to …" in the
SYSTEM language, so the reason is always an English verb phrase
("reveal the secret "X"", "unlock Zekra"); a translated reason would read as
a mixed-language sentence whenever the app and macOS languages differ.
*/

export type Decision = "proceed" | "cancel" | "failed";

/** Touch ID can be used right now (hardware present, enrolled, lid open). */
export async function touchIdAvailable(): Promise<boolean> {
  try {
    return await bridge().canPromptTouchId();
  } catch {
    return false;
  }
}

function isCancel(error: string | undefined): boolean {
  // LAContext: "Canceled by user.", "…canceled by system", "Fallback authentication mechanism selected."
  return !!error && /cancel|fallback/i.test(error);
}

/**
 * Ask for Touch ID. `unavailable` answers when there is no Touch ID; the
 * caller decides the fallback (vault: a native confirm; the lock: none).
 */
export async function promptTouchId(reason: string): Promise<Decision | "unavailable"> {
  if (!(await touchIdAvailable())) return "unavailable";
  lockState.setPrompting(true);
  try {
    const out = await bridge().promptTouchId(reason);
    if (out.ok) return "proceed";
    if (out.error === "unavailable") return "unavailable";
    return isCancel(out.error) ? "cancel" : "failed";
  } catch {
    return "failed";
  } finally {
    // The window regains focus a beat after the system sheet closes.
    setTimeout(() => lockState.setPrompting(false), 400);
  }
}

/**
 * Touch ID, or — on a Mac without it — a native confirmation dialog. Used by
 * the vault: the server's write-access check is the real gate; this is the
 * "is it still you at the keyboard" check.
 */
export async function confirmOwner(
  reason: string,
  fallback: { message: string; detail: string; confirm: string; cancel: string },
): Promise<Decision> {
  const out = await promptTouchId(reason);
  if (out !== "unavailable") return out;
  lockState.setPrompting(true);
  try {
    const { response } = await bridge().confirm({
      type: "warning",
      message: fallback.message,
      detail: fallback.detail,
      buttons: [fallback.confirm, fallback.cancel],
      defaultId: 1,
      cancelId: 1,
    });
    return response === 0 ? "proceed" : "cancel";
  } catch {
    return "failed";
  } finally {
    setTimeout(() => lockState.setPrompting(false), 400);
  }
}
