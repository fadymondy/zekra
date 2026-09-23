import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Square, SquareCheck } from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { AwaitNote, BottomSheet, ErrorLine, FilterStrip, Spinner, toast } from "@/components/kit";
import { AppText, Field, PrimaryButton, SecondaryButton, Segmented } from "@/components/ui";
import { ApiError, zekraApi, type Brain } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { fonts, metrics, usePalette } from "@/theme";

import { presentationsApi } from "./api";
import { KindIcon, useDebounced, useFormat } from "./parts";
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
} from "./presentations-core";
import type { PLocale, PStyle } from "./types";

/*
"Create from brain" (POST /api/presentations/from-brain): the server drafts
the chosen kinds from the brain's own material only — the whole brain, a
recall query, or picked notes — in one language; the other language comes
from Translate on the presentation. Documents start as drafts.
*/

function blank(locale: PLocale): FromBrainForm {
  return { mode: "namespace", q: "", noteIds: [], kinds: [...KINDS], locale, name: "", company: "", email: "", title: "", style: "minimal" };
}

export function CreateFromBrainSheet({ brain, open, onClose }: { brain: Brain; open: boolean; onClose: () => void }) {
  const p = usePalette();
  const { t, locale } = useI18n();
  const f = useFormat();
  const { token } = useAuth();
  const client = useQueryClient();
  const [form, setForm] = useState<FromBrainForm>(() => blank(locale));
  const [problems, setProblems] = useState<FormProblem[]>([]);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [noteSearch, setNoteSearch] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const q = useDebounced(noteSearch.trim(), 300);

  useEffect(() => {
    if (open) {
      setProblems([]);
      setServerErrors([]);
    }
  }, [open]);

  const set = (patch: Partial<FromBrainForm>) => {
    setForm((cur) => ({ ...cur, ...patch }));
    setProblems([]);
  };

  const notes = useQuery({
    queryKey: ["presentations-source-notes", token, brain.namespace, q],
    queryFn: () => zekraApi.notes(token!, brain.namespace, { q: q || undefined, limit: 50 }),
    enabled: open && !!token && form.mode === "notes",
    staleTime: 30_000,
  });

  const create = useMutation({
    mutationFn: () => presentationsApi.fromBrain(token!, fromBrainBody(brain.namespace, form)),
    onSuccess: (out) => {
      toast(t("presentations.fb.created", { n: out.documents?.length ?? 0 }), "ok");
      void client.invalidateQueries({ queryKey: ["presentations"] });
      setForm(blank(locale));
      setPicked({});
      setNoteSearch("");
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError) setServerErrors(errorMessages(err.payload, err.message || t("kit.error")));
      else setServerErrors([err instanceof Error ? err.message : t("kit.error")]);
    },
  });

  const submit = () => {
    const found = formProblems(form);
    setProblems(found);
    setServerErrors([]);
    if (!found.length) create.mutate();
  };

  const problemText = (key: FormProblem) =>
    problems.includes(key) ? <ErrorLine text={t(`presentations.fb.problem.${key}`)} /> : null;

  const noteList = notes.data?.notes ?? [];

  return (
    <BottomSheet open={open} onClose={onClose} title={t("presentations.fb.title")} subtitle={brain.displayName || brain.namespace} maxHeight={0.94}>
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        <AwaitNote text={t("presentations.fb.draftNote")} />

        <Section label={t("presentations.fb.source")}>
          <Segmented<SourceMode>
            value={form.mode}
            onChange={(mode) => set({ mode })}
            options={[
              { value: "namespace", label: t("presentations.fb.source.namespace") },
              { value: "query", label: t("presentations.fb.source.query") },
              { value: "notes", label: t("presentations.fb.source.notes") },
            ]}
          />
          {form.mode === "namespace" ? <AppText variant="meta">{t("presentations.fb.source.namespaceHelp")}</AppText> : null}
          {form.mode === "query" ? (
            <>
              <Field value={form.q} onChangeText={(v) => set({ q: v })} placeholder={t("presentations.fb.queryPlaceholder")} maxLength={300} returnKeyType="done" />
              {problemText("query")}
            </>
          ) : null}
          {form.mode === "notes" ? (
            <>
              <Field value={noteSearch} onChangeText={setNoteSearch} placeholder={t("presentations.fb.notesSearch")} returnKeyType="search" autoCorrect={false} />
              <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
                style={[styles.noteBox, { borderColor: p.line, backgroundColor: p.bg }]}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
              >
                {notes.isPending ? (
                  <View style={{ padding: 16, alignItems: "center" }}><Spinner /></View>
                ) : notes.error ? (
                  <View style={{ padding: 12 }}><ErrorLine text={notes.error.message || t("kit.error")} /></View>
                ) : noteList.length === 0 ? (
                  <View style={{ padding: 12 }}><AppText variant="meta">{t("presentations.fb.noNotes")}</AppText></View>
                ) : (
                  noteList.map((n, i) => {
                    const on = form.noteIds.includes(n.id);
                    const Icon = on ? SquareCheck : Square;
                    return (
                      <Pressable
                        key={n.id}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        onPress={() => {
                          set({ noteIds: toggleId(form.noteIds, n.id) });
                          setPicked((m) => ({ ...m, [n.id]: n.title }));
                        }}
                        style={({ pressed }) => [
                          styles.noteItem,
                          i > 0 && { borderTopWidth: 1, borderTopColor: p.soft },
                          pressed && { backgroundColor: p.soft },
                        ]}
                      >
                        <Icon size={18} color={on ? p.gold : p.muted} strokeWidth={1.6} />
                        <AppText numberOfLines={1} style={{ flex: 1, fontFamily: fonts.regular, fontSize: 14, color: on ? p.ink : p.body }}>
                          {n.title || t("common.untitled")}
                        </AppText>
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>
              <AppText variant="micro">
                {t("presentations.fb.notesSelected", { n: form.noteIds.length, max: MAX_SOURCE_NOTES }).toUpperCase()}
              </AppText>
              {form.noteIds.length ? (
                <AppText variant="meta" numberOfLines={2}>
                  {form.noteIds.map((id) => picked[id] || t("common.untitled")).join(" · ")}
                </AppText>
              ) : null}
              {problemText("notes")}
            </>
          ) : null}
        </Section>

        <Section label={t("presentations.fb.kinds")}>
          <View style={styles.kinds}>
            {KINDS.map((k) => (
              <SecondaryButton
                key={k}
                label={f.kind(k)}
                selected={form.kinds.includes(k)}
                icon={<KindIcon kind={k} size={16} color={form.kinds.includes(k) ? p.gold : p.muted} />}
                onPress={() => set({ kinds: toggleKind(form.kinds, k) })}
                style={{ flexGrow: 1, paddingHorizontal: 12 }}
              />
            ))}
          </View>
          {problemText("kinds")}
        </Section>

        {form.kinds.includes("page") ? (
          <Section label={t("presentations.fb.style")}>
            <FilterStrip<PStyle>
              inset={false}
              value={form.style}
              onChange={(style) => set({ style })}
              options={STYLES.map((s) => ({ value: s, label: t(`presentations.style.${s}`) }))}
            />
          </Section>
        ) : null}

        <Section label={t("presentations.fb.language")}>
          <Segmented<PLocale>
            value={form.locale}
            onChange={(l) => set({ locale: l })}
            options={[
              { value: "en", label: t("presentations.locale.en") },
              { value: "ar", label: t("presentations.locale.ar") },
            ]}
          />
          <AppText variant="meta">{t("presentations.fb.languageHelp")}</AppText>
        </Section>

        <Section label={t("presentations.fb.customer")}>
          <Field value={form.company} onChangeText={(v) => set({ company: v })} placeholder={t("presentations.fb.company")} maxLength={160} />
          <Field value={form.name} onChangeText={(v) => set({ name: v })} placeholder={t("presentations.fb.name")} maxLength={160} />
          <Field
            value={form.email}
            onChangeText={(v) => set({ email: v })}
            placeholder={t("presentations.fb.email")}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            style={{ textAlign: "left", writingDirection: "ltr" }}
          />
          {problemText("customer")}
          {problemText("email")}
        </Section>

        <Field label={t("presentations.fb.titleField")} value={form.title} onChangeText={(v) => set({ title: v })} placeholder={t("presentations.fb.titlePlaceholder")} maxLength={200} />

        {serverErrors.length ? (
          <View style={{ gap: 4 }}>
            {serverErrors.map((m, i) => <ErrorLine key={i} text={m} />)}
          </View>
        ) : null}

        <PrimaryButton label={t("presentations.fb.submit")} loading={create.isPending} onPress={submit} />
      </ScrollView>
    </BottomSheet>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <AppText variant="micro">{label.toUpperCase()}</AppText>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: metrics.padX, paddingTop: 4, paddingBottom: 12, gap: 18 },
  noteBox: { borderWidth: 1, borderRadius: metrics.radius.control, maxHeight: 264, flexGrow: 0 },
  noteItem: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12 },
  kinds: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
