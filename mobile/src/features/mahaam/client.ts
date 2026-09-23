import * as ImagePicker from "expo-image-picker";

import { MAHAAM_APP_URL, MAHAAM_FEEDBACK_KEY, MAHAAM_FEEDBACK_URL } from "./config";
import { deviceInfo, diagnostics } from "./diagnostics";
import { buildFeedbackFields, classifyResponse, MAX_SCREENSHOT_BYTES, screenshotTypeOk, type FeedbackDraft, type SubmitOutcome } from "./mahaam-core";

// The Mahaam Feedback client for React Native. @mahaam/feedback-core (the web
// SDK) is not on npm and is DOM-bound (window, XMLHttpRequest, Blob, canvas
// capture), so this is the same wire contract over RN's fetch + FormData.
//
// ORIGIN: a native request has no Origin header. The intake then checks the
// origin of `page_url` against the key's allowlist (internal/reports/embed.go),
// so page_url is built on MAHAAM_APP_URL (https://app.zekra.dev, an allowed
// origin). No Origin header is forged: that would only matter to a browser, and
// the server already has this non-browser path (the Mahaam Go SDK uses it too).
// The trade-off is the same either way — a public pfk_ key plus an allowed
// page_url is all it takes to file into the project, which is why the key can do
// nothing else and the intake is rate limited per IP.

export type Attachment = { uri: string; type: string; name: string; source?: "screen" | "library" };

export type FeedbackSubmission = {
  draft: FeedbackDraft;
  includeDiagnostics: boolean;
  attachment?: Attachment | null;
};

export async function submitFeedback({ draft, includeDiagnostics, attachment }: FeedbackSubmission): Promise<SubmitOutcome> {
  const fields = buildFeedbackFields({
    key: MAHAAM_FEEDBACK_KEY,
    appUrl: MAHAAM_APP_URL,
    draft,
    device: includeDiagnostics ? deviceInfo() : null,
    crumbs: diagnostics.crumbs(),
    consoleLog: diagnostics.consoleLog(),
    networkLog: diagnostics.networkLog(),
  });
  const form = new FormData();
  for (const [key, value] of fields) form.append(key, value);
  // RN's FormData takes a { uri, name, type } file part; `type` becomes the part's
  // Content-Type, which the server checks (PNG / JPEG / WebP only).
  if (attachment) form.append("screenshot", { uri: attachment.uri, name: attachment.name, type: attachment.type } as unknown as Blob);

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 30000);
  try {
    const res = await fetch(MAHAAM_FEEDBACK_URL, {
      method: "POST",
      body: form,
      headers: { Accept: "application/json" },
      credentials: "omit",
      signal: ctl.signal,
    });
    const body = await res.json().catch(() => undefined);
    return classifyResponse(res.status, body);
  } catch {
    return { ok: false, reason: "failed" };
  } finally {
    clearTimeout(timer);
  }
}

const EXT_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/**
 * An image from the photo library, or why not. iOS is asked for the
 * "compatible" representation, so a HEIC photo arrives as JPEG — the intake
 * takes PNG, JPEG and WebP only, up to 8 MB.
 */
export async function pickAttachment(): Promise<{ attachment: Attachment } | { error: "type" | "size" } | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    quality: 0.8,
    allowsMultipleSelection: false,
    preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });
  if (result.canceled || !result.assets?.length) return null;
  const a = result.assets[0];
  const ext = (a.fileName ?? a.uri).split("?")[0].split(".").pop()?.toLowerCase() ?? "";
  const type = (a.mimeType ?? EXT_TYPES[ext] ?? "").toLowerCase();
  if (!screenshotTypeOk(type)) return { error: "type" };
  if ((a.fileSize ?? 0) > MAX_SCREENSHOT_BYTES) return { error: "size" };
  const name = `screenshot.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`;
  return { attachment: { uri: a.uri, type, name, source: "library" } };
}
