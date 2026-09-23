import { useEffect, useState, type ReactNode } from "react";
import { CheckSquare, Loader2, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  KINDS,
  MAX_SOURCE_NOTES,
  STYLES,
  errorMessages,
  formProblems,
  fromBrainBody,
  toggleId,
  toggleKind,
  type FormProblem,
  type FromBrainForm,
  type SourceMode,
} from "@mobile/features/presentations/presentations-core";
import type { PLocale, PStyle } from "@mobile/features/presentations/types";

import { ApiError, zekraApi, type Brain, type Note } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { toast } from "../../shell/toast";
import { presentationsApi } from "./api";
import { useDebounced, useFormat } from "./format";
import { ErrorLines, KindIcon, Segmented, ToggleChip } from "./parts";

/*
"Create from brain" (POST /api/presentations/from-brain), ported from
mobile's create-sheet.tsx: the server drafts the chosen kinds from the
brain's own material only — the whole brain, a recall query, or picked notes
— in one language; the other language comes from Translate on the
presentation. Documents start as drafts. 422s list their field errors.
*/

function blank(locale: PLocale): FromBrainForm {
  return { mode: "namespace", q: "", noteIds: [], kinds: [...KINDS], locale, name: "", company: "", email: "", title: "", style: "minimal" };
}

export function CreateFromBrainDialog({ brain, token, open, onClose, onCreated }: {
  brain: Brain;
  token: string;
  open: boolean;
  onClose: () => void;
  /** The ids of the drafts made, first one first. */
  onCreated: (ids: string[]) => void;
}) {
  const { t, locale } = useI18n();
  const f = useFormat();
  const [form, setForm] = useState<FromBrainForm>(() => blank(locale));
  const [problems, setProblems] = useState<FormProblem[]>([]);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [noteSearch, setNoteSearch] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<{ loading: boolean; error: string; list: Note[] }>({ loading: false, error: "", list: [] });
  const q = useDebounced(noteSearch.trim(), 300);

  useEffect(() => {
    if (open) {
      setProblems([]);
      setServerErrors([]);
    }
  }, [open]);

  // The note picker's list, only while the Notes source is chosen.
  useEffect(() => {
    if (!open || form.mode !== "notes") return;
    let alive = true;
    setNotes((n) => ({ ...n, loading: true, error: "" }));
    zekraApi
      .notes(token, brain.namespace, { q: q || undefined, limit: 50 })
      .then((page) => alive && setNotes({ loading: false, error: "", list: page.notes ?? [] }))
      .catch((e: unknown) => alive && setNotes({ loading: false, error: e instanceof Error ? e.message : t("kit.error"), list: [] }));
    return () => {
      alive = false;
    };
  }, [open, form.mode, q, token, brain.namespace, t]);

  const set = (patch: Partial<FromBrainForm>) => {
    setForm((cur) => ({ ...cur, ...patch }));
    setProblems([]);
  };

  async function submit() {
    const found = formProblems(form);
    setProblems(found);
    setServerErrors([]);
    if (found.length) return;
    setBusy(true);
    try {
      const out = await presentationsApi.fromBrain(token, fromBrainBody(brain.namespace, form));
      const docs = out.documents ?? [];
      toast.success(t("presentations.fb.created", { n: docs.length }));
      setForm(blank(locale));
      setPicked({});
      setNoteSearch("");
      onCreated(docs.map((d) => d.id));
      onClose();
    } catch (err) {
      if (err instanceof ApiError) setServerErrors(errorMessages(err.payload, err.message || t("kit.error")));
      else setServerErrors([err instanceof Error ? err.message : t("kit.error")]);
    } finally {
      setBusy(false);
    }
  }

  const problem = (key: FormProblem) =>
    problems.includes(key) ? <p className="text-xs text-destructive">{t(`presentations.fb.problem.${key}`)}</p> : null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="border-b border-border/60 p-4">
          <DialogTitle>{t("presentations.fb.title")}</DialogTitle>
          <DialogDescription>{brain.displayName || brain.namespace}</DialogDescription>
        </DialogHeader>

        <form
          id="pres-create"
          className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="rounded-md border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground">{t("presentations.fb.draftNote")}</p>

          <Section label={t("presentations.fb.source")}>
            <Segmented<SourceMode>
              label={t("presentations.fb.source")}
              value={form.mode}
              onChange={(mode) => set({ mode })}
              options={[
                { value: "namespace", label: t("presentations.fb.source.namespace") },
                { value: "query", label: t("presentations.fb.source.query") },
                { value: "notes", label: t("presentations.fb.source.notes") },
              ]}
            />
            {form.mode === "namespace" ? <p className="text-xs text-muted-foreground">{t("presentations.fb.source.namespaceHelp")}</p> : null}
            {form.mode === "query" ? (
              <>
                <Input value={form.q} onChange={(e) => set({ q: e.target.value })} placeholder={t("presentations.fb.queryPlaceholder")} maxLength={300} />
                {problem("query")}
              </>
            ) : null}
            {form.mode === "notes" ? (
              <>
                <Input value={noteSearch} onChange={(e) => setNoteSearch(e.target.value)} placeholder={t("presentations.fb.notesSearch")} spellCheck={false} />
                <div className="max-h-56 overflow-y-auto rounded-md border border-border/60 bg-background">
                  {notes.loading ? (
                    <div className="flex justify-center p-4 text-muted-foreground">
                      <Loader2 className="size-4 animate-spin" />
                    </div>
                  ) : notes.error ? (
                    <p className="p-3 text-xs text-destructive">{notes.error}</p>
                  ) : notes.list.length === 0 ? (
                    <p className="p-3 text-xs text-muted-foreground">{t("presentations.fb.noNotes")}</p>
                  ) : (
                    notes.list.map((n, i) => {
                      const on = form.noteIds.includes(n.id);
                      const Icon = on ? CheckSquare : Square;
                      return (
                        <button
                          key={n.id}
                          type="button"
                          role="checkbox"
                          aria-checked={on}
                          onClick={() => {
                            set({ noteIds: toggleId(form.noteIds, n.id) });
                            setPicked((m) => ({ ...m, [n.id]: n.title }));
                          }}
                          className={cn(
                            "flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm transition-colors hover:bg-hover",
                            i > 0 && "border-t border-border/60",
                          )}
                        >
                          <Icon className={cn("size-4 shrink-0", on ? "text-grid-gold" : "text-muted-foreground")} strokeWidth={1.6} />
                          <span className={cn("truncate", on ? "text-foreground" : "text-foreground/85")} dir="auto" style={{ unicodeBidi: "plaintext" }}>
                            {n.title || t("notes.untitled")}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
                <span className="grid-micro text-muted-foreground">
                  {t("presentations.fb.notesSelected", { n: form.noteIds.length, max: MAX_SOURCE_NOTES })}
                </span>
                {form.noteIds.length ? (
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {form.noteIds.map((id) => picked[id] || t("notes.untitled")).join(" · ")}
                  </p>
                ) : null}
                {problem("notes")}
              </>
            ) : null}
          </Section>

          <Section label={t("presentations.fb.kinds")}>
            <div className="flex flex-wrap gap-2">
              {KINDS.map((k) => (
                <ToggleChip key={k} on={form.kinds.includes(k)} onClick={() => set({ kinds: toggleKind(form.kinds, k) })}>
                  <KindIcon kind={k} className={cn("size-3.5", form.kinds.includes(k) ? "text-grid-gold" : "text-muted-foreground")} />
                  {f.kind(k)}
                </ToggleChip>
              ))}
            </div>
            {problem("kinds")}
          </Section>

          {form.kinds.includes("page") ? (
            <Section label={t("presentations.fb.style")}>
              <div className="flex flex-wrap gap-2">
                {STYLES.map((s) => (
                  <ToggleChip key={s} on={form.style === s} onClick={() => set({ style: s as PStyle })}>
                    {f.style(s)}
                  </ToggleChip>
                ))}
              </div>
            </Section>
          ) : null}

          <Section label={t("presentations.fb.language")}>
            <Segmented<PLocale>
              label={t("presentations.fb.language")}
              value={form.locale}
              onChange={(l) => set({ locale: l })}
              options={[
                { value: "en", label: t("presentations.locale.en") },
                { value: "ar", label: t("presentations.locale.ar") },
              ]}
            />
            <p className="text-xs text-muted-foreground">{t("presentations.fb.languageHelp")}</p>
          </Section>

          <Section label={t("presentations.fb.customer")}>
            <div className="grid grid-cols-2 gap-2">
              <Input value={form.company} onChange={(e) => set({ company: e.target.value })} placeholder={t("presentations.fb.company")} maxLength={160} />
              <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder={t("presentations.fb.name")} maxLength={160} />
            </div>
            <Input
              dir="ltr"
              type="email"
              value={form.email}
              onChange={(e) => set({ email: e.target.value })}
              placeholder={t("presentations.fb.email")}
              className="text-start"
              spellCheck={false}
            />
            {problem("customer")}
            {problem("email")}
          </Section>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pres-title">{t("presentations.fb.titleField")}</Label>
            <Input id="pres-title" value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder={t("presentations.fb.titlePlaceholder")} maxLength={200} />
          </div>

          <ErrorLines lines={serverErrors} />
        </form>

        <DialogFooter className="m-0 border-t border-border/60 p-4">
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {t("action.cancel")}
          </Button>
          <Button type="submit" form="pres-create" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            {busy ? t("presentations.working") : t("presentations.fb.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="grid-micro text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}
