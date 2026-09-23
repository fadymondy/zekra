import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ago,
  customerLine,
  downloadUrl,
  downloadVia,
  editUrl,
  errorMessages,
  expiry,
  exportFileName,
  formProblems,
  fromBrainBody,
  knownUrl,
  listQuery,
  missingLocale,
  orderedLocales,
  PREVIEW_LABEL,
  previewUrl,
  shareState,
  shareUrlForLocale,
  sortShares,
  statusTone,
  toggleId,
  toggleKind,
  webOriginFrom,
  type FromBrainForm,
} from "./presentations-core.ts";
import type { Share } from "./types.ts";

/*
Pure helpers of the mobile presentations feature (MH-369). Run with the repo's
`node --test`; nothing here touches React Native.
*/

const NOW = Date.parse("2026-09-23T12:00:00Z");
const TOKEN = "a".repeat(43);

function share(over: Partial<Share> = {}): Share {
  return {
    id: "s1",
    presentation_id: "p1",
    label: "",
    locale: "en",
    hint: "aaaa",
    url: `https://app.zekra.dev/en/p/${TOKEN}`,
    recoverable: true,
    domain_id: "",
    domain: "app.zekra.dev",
    expires_at: null,
    revoked_at: null,
    active: true,
    view_count: 0,
    download_count: 0,
    last_viewed_at: null,
    created_at: "2026-09-01T00:00:00Z",
    ...over,
  };
}

test("webOriginFrom: the API base maps back to the console origin", () => {
  assert.equal(webOriginFrom("https://app.zekra.dev"), "https://app.zekra.dev");
  assert.equal(webOriginFrom("https://app.zekra.dev/"), "https://app.zekra.dev");
  assert.equal(webOriginFrom("https://app.zekra.dev/api"), "https://app.zekra.dev");
  assert.equal(webOriginFrom("https://api.zekra.dev"), "https://app.zekra.dev");
  assert.equal(webOriginFrom("http://192.168.1.4:8080"), "http://192.168.1.4:8080");
  assert.equal(webOriginFrom("garbage"), "https://app.zekra.dev");
});

test("editUrl points at the web editor, escaping the namespace", () => {
  assert.equal(editUrl("https://app.zekra.dev", "ar", "flow os", "abc"), "https://app.zekra.dev/ar/b/flow%20os/presentations/abc");
  assert.equal(editUrl("https://app.zekra.dev", "fr", "ns", "abc"), "https://app.zekra.dev/en/b/ns/presentations/abc");
});

test("shareUrlForLocale swaps only the locale segment", () => {
  const url = `https://app.zekra.dev/en/p/${TOKEN}`;
  assert.equal(shareUrlForLocale(url, "ar"), `https://app.zekra.dev/ar/p/${TOKEN}`);
  assert.equal(shareUrlForLocale(url, "en"), url);
  assert.equal(shareUrlForLocale(`https://decks.acme.com/ar/p/${TOKEN}`, "en"), `https://decks.acme.com/en/p/${TOKEN}`);
});

test("downloadUrl follows downloadsFor", () => {
  assert.equal(downloadUrl(`https://app.zekra.dev/en/p/${TOKEN}`, "pdf"), `https://app.zekra.dev/en/p/${TOKEN}/download/pdf`);
  assert.equal(downloadUrl(`https://app.zekra.dev/en/p/${TOKEN}/`, "docx"), `https://app.zekra.dev/en/p/${TOKEN}/download/docx`);
});

test("shareState: revoked beats expired beats active", () => {
  assert.equal(shareState({ active: true, revoked_at: null }), "active");
  assert.equal(shareState({ active: false, revoked_at: null }), "expired");
  assert.equal(shareState({ active: false, revoked_at: "2026-09-01T00:00:00Z" }), "revoked");
});

test("knownUrl: the API's URL, else this session's, never for inactive links", () => {
  assert.equal(knownUrl(share()), share().url);
  assert.equal(knownUrl(share({ url: "" }), { s1: "https://x/en/p/t" }), "https://x/en/p/t");
  assert.equal(knownUrl(share({ url: "" })), "");
  assert.equal(knownUrl(share({ active: false }), { s1: "https://x/en/p/t" }), "");
});

test("sortShares puts active links first and keeps the API order otherwise", () => {
  const list = [
    share({ id: "a", active: false, revoked_at: "2026-01-01T00:00:00Z" }),
    share({ id: "b" }),
    share({ id: "c", active: false }),
    share({ id: "d" }),
  ];
  assert.deepEqual(sortShares(list).map((s) => s.id), ["b", "d", "a", "c"]);
});

test("previewUrl prefers the app's own preview link", () => {
  const customer = share({ id: "c", label: "Acme" });
  const own = share({ id: "p", label: PREVIEW_LABEL, url: `https://app.zekra.dev/en/p/${"b".repeat(43)}` });
  assert.equal(previewUrl([customer, own], {}, "ar", true), `https://app.zekra.dev/ar/p/${"b".repeat(43)}`);
  // A writer without a preview link creates one rather than using the customer's.
  assert.equal(previewUrl([customer], {}, "en", true), "");
  // A reader cannot create links, so falls back to any known link, same locale first.
  const arLink = share({ id: "r", locale: "ar", url: `https://app.zekra.dev/ar/p/${"c".repeat(43)}` });
  assert.equal(previewUrl([customer, arLink], {}, "ar", false), `https://app.zekra.dev/ar/p/${"c".repeat(43)}`);
  assert.equal(previewUrl([share({ url: "", recoverable: false })], {}, "en", false), "");
});

test("downloadVia uses a customer link in the language, then any known link", () => {
  const en = share({ id: "e" });
  const own = share({ id: "p", label: PREVIEW_LABEL, locale: "ar", url: `https://app.zekra.dev/ar/p/${"b".repeat(43)}` });
  assert.equal(downloadVia([own, en], {}, "en", "pdf"), `https://app.zekra.dev/en/p/${TOKEN}/download/pdf`);
  assert.equal(downloadVia([en], {}, "ar", "docx"), `https://app.zekra.dev/ar/p/${TOKEN}/download/docx`);
  assert.equal(downloadVia([share({ url: "" })], {}, "en", "pdf"), "");
});

test("statusTone maps draft/ready/archived to muted/ok/warn", () => {
  assert.equal(statusTone("draft"), "muted");
  assert.equal(statusTone("ready"), "ok");
  assert.equal(statusTone("archived"), "warn");
  assert.equal(statusTone("weird"), "muted");
});

test("missingLocale / orderedLocales", () => {
  assert.equal(missingLocale(["en"]), "ar");
  assert.equal(missingLocale(["ar"]), "en");
  assert.equal(missingLocale(["en", "ar"]), null);
  assert.equal(missingLocale(null), null);
  assert.deepEqual(orderedLocales(["ar", "en"]), ["en", "ar"]);
  assert.deepEqual(orderedLocales(null), []);
});

test("ago: compact relative time", () => {
  assert.equal(ago(null, NOW), null);
  assert.equal(ago("not a date", NOW), null);
  assert.deepEqual(ago("2026-09-23T11:59:30Z", NOW), { unit: "now" });
  assert.deepEqual(ago("2026-09-23T11:55:00Z", NOW), { unit: "m", n: 5 });
  assert.deepEqual(ago("2026-09-23T09:00:00Z", NOW), { unit: "h", n: 3 });
  assert.deepEqual(ago("2026-09-21T12:00:00Z", NOW), { unit: "d", n: 2 });
  assert.deepEqual(ago("2026-07-01T12:00:00Z", NOW), { unit: "date" });
});

test("expiry: never, past, today, days left", () => {
  assert.deepEqual(expiry(null, NOW), { kind: "never" });
  assert.deepEqual(expiry("2026-09-22T12:00:00Z", NOW), { kind: "past" });
  assert.deepEqual(expiry("2026-09-23T20:00:00Z", NOW), { kind: "today" });
  assert.deepEqual(expiry("2026-09-30T13:00:00Z", NOW), { kind: "days", n: 7 });
});

test("listQuery drops empty and 'all' filters", () => {
  assert.equal(listQuery({ namespace: "flowos" }), "?namespace=flowos");
  assert.equal(
    listQuery({ namespace: "flow os", q: "  acme  ", kind: "deck", status: "ready", limit: 100 }),
    "?namespace=flow%20os&q=acme&kind=deck&status=ready&limit=100",
  );
  assert.equal(listQuery({ namespace: "n", q: " ", kind: "all", status: "all" }), "?namespace=n");
});

test("customerLine joins company and name", () => {
  assert.equal(customerLine({ name: "Sara", company: "Acme" }), "Acme · Sara");
  assert.equal(customerLine({ name: "", company: "Acme" }), "Acme");
  assert.equal(customerLine(null), "");
});

const form: FromBrainForm = {
  mode: "namespace",
  q: "",
  noteIds: [],
  kinds: ["deck", "report", "page"],
  locale: "en",
  name: "",
  company: "Acme",
  email: "",
  title: "",
  style: "bold",
};

test("formProblems mirrors the server's source rules and the customer rule", () => {
  assert.deepEqual(formProblems(form), []);
  assert.deepEqual(formProblems({ ...form, mode: "notes" }), ["notes"]);
  assert.deepEqual(formProblems({ ...form, mode: "query", q: "  " }), ["query"]);
  assert.deepEqual(formProblems({ ...form, kinds: [] }), ["kinds"]);
  assert.deepEqual(formProblems({ ...form, company: " ", name: "" }), ["customer"]);
  assert.deepEqual(formProblems({ ...form, email: "nope" }), ["email"]);
  assert.deepEqual(formProblems({ ...form, mode: "notes", noteIds: Array.from({ length: 51 }, (_, i) => String(i)) }), ["notes"]);
});

test("fromBrainBody builds the request; style only with a page", () => {
  assert.deepEqual(fromBrainBody("ns", form), {
    namespace: "ns",
    source: { kind: "namespace" },
    kinds: ["deck", "report", "page"],
    locale: "en",
    customer: { name: "", company: "Acme" },
    style: "bold",
  });
  const notes = fromBrainBody("ns", { ...form, mode: "notes", noteIds: ["a", "b"], kinds: ["report", "deck"], email: " s@acme.com ", title: " T ", locale: "ar" });
  assert.deepEqual(notes, {
    namespace: "ns",
    source: { kind: "notes", ids: ["a", "b"] },
    kinds: ["deck", "report"],
    locale: "ar",
    customer: { name: "", company: "Acme", email: "s@acme.com" },
    title: "T",
  });
  assert.deepEqual(fromBrainBody("ns", { ...form, mode: "query", q: " pricing " }).source, { kind: "query", q: "pricing" });
});

test("toggleId caps at 50; toggleKind keeps deck, report, page order", () => {
  assert.deepEqual(toggleId(["a"], "b"), ["a", "b"]);
  assert.deepEqual(toggleId(["a", "b"], "a"), ["b"]);
  const full = Array.from({ length: 50 }, (_, i) => String(i));
  assert.equal(toggleId(full, "x").length, 50);
  assert.deepEqual(toggleKind(["page"], "deck"), ["deck", "page"]);
  assert.deepEqual(toggleKind(["deck", "page"], "deck"), ["page"]);
});

test("errorMessages reads writePresErr's 422 shapes", () => {
  assert.deepEqual(
    errorMessages(
      { error: { code: "invalid_content", message: "the content is not valid" }, detail: "the content is not valid", errors: [{ path: "slides[0].title", message: "is required" }] },
      "x",
    ),
    ["the content is not valid", "slides[0].title: is required"],
  );
  assert.deepEqual(errorMessages({ error: { code: "invalid_argument", message: "source.ids: give 1 to 50 note ids" } }, "x"), ["source.ids: give 1 to 50 note ids"]);
  assert.deepEqual(errorMessages({ detail: "bad" }, "x"), ["bad"]);
  assert.deepEqual(errorMessages(undefined, "fallback"), ["fallback"]);
});

test("exportFileName keeps letters (Arabic too) and drops the rest", () => {
  assert.equal(exportFileName("Acme: Q3 plan!", "en", "pdf"), "Acme-Q3-plan-en.pdf");
  assert.equal(exportFileName("خطة أكمي", "ar", "docx"), "خطة-أكمي-ar.docx");
  assert.equal(exportFileName("***", "en", "pdf"), "presentation-en.pdf");
});
