import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import {
  Archive,
  ArchiveRestore,
  Check,
  Code,
  Copy,
  Download,
  FileDown,
  FileImage,
  FileText,
  FileType,
  History,
  Palette,
  Pin,
  PinOff,
  RotateCcw,
  Share2,
  Trash2,
  Type,
  type LucideIcon,
} from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Share, StyleSheet, View } from "react-native";

import { AwaitNote, BottomSheet, Chip, ErrorLine, ForwardChevron, Meta, SheetDivider, SheetItem, Spinner, TextButton, toast, useChevrons } from "@/components/kit";
import { AppText, PrimaryButton } from "@/components/ui";
import { exportNote, type ExportFormat } from "@/features/editor/export";
import type { Brain, Note } from "@/lib/api";
import { useI18n, type TKey } from "@/lib/i18n";
import { noteIcon } from "@/lib/note-icon";
import { useAuth } from "@/providers/auth";
import { metrics, usePalette } from "@/theme";

import { noteKeys, notesApi, type NoteVersion } from "./api";
import { formatStamp } from "./format";
import { NOTE_COLORS, NOTE_ICON_NAMES, noteMarkdown } from "./notes-core";
import type { NoteActions } from "./use-note-actions";

/*
The long-press sheet (MH-364): every action the web offers on a note — the
row's context menu plus the editor's ⋯ menu — in one bottom sheet.

Sub-menus (appearance, versions, a version, export) are pages of the SAME
sheet rather than sheets stacked on sheets: two RN Modals presenting at once
are unreliable on iOS, and a page keeps the note's title in view.

The sheet sits in a Modal, above the toast host — so anything that can fail
while the sheet stays open also shows its error inline. Confirmations are
native alerts over the sheet; the sheet closes only once the user confirms.
*/

type Page = "menu" | "appearance" | "versions" | "export" | { version: NoteVersion };

const FORMATS: { format: ExportFormat; label: TKey; Icon: LucideIcon }[] = [
  { format: "md", label: "notes.x.fmt.md", Icon: FileText },
  { format: "html", label: "notes.x.fmt.html", Icon: Code },
  { format: "pdf", label: "notes.x.fmt.pdf", Icon: FileDown },
  { format: "docx", label: "notes.x.fmt.docx", Icon: FileType },
  { format: "png", label: "notes.x.fmt.png", Icon: FileImage },
  { format: "txt", label: "notes.x.fmt.txt", Icon: Type },
];

export function NoteSheet({ note, brain, open, onClose, onOpenNote, actions }: {
  /** Kept by the caller after closing, so the sheet can animate out with content. */
  note: Note | null;
  brain: Brain;
  open: boolean;
  onClose: () => void;
  onOpenNote: (note: Note) => void;
  actions: NoteActions;
}) {
  const p = usePalette();
  const { t, locale } = useI18n();
  const [page, setPage] = useState<Page>("menu");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Every opening starts at the menu.
  useEffect(() => {
    if (open) {
      setPage("menu");
      setError(null);
      setBusy(null);
    }
  }, [open, note?.id]);

  const go = (next: Page) => {
    setError(null);
    setPage(next);
  };

  if (!note) return null;
  const canWrite = brain.canWrite;
  const icon = (Icon: LucideIcon, color = p.muted) => <Icon size={18} color={color} strokeWidth={1.7} />;

  async function copy() {
    try {
      await Clipboard.setStringAsync(noteMarkdown(note!));
      onClose();
      toast(t("notes.x.copied"), "ok");
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t("notes.x.failed"));
    }
  }

  // Shared while the sheet is still up: iOS presents the share sheet over the
  // top-most controller, and dismissing ours underneath it would take it down.
  async function share() {
    setBusy("share");
    try {
      await Share.share({ title: note!.title || t("notes.x.untitled"), message: noteMarkdown(note!) });
      onClose();
    } catch {
      setError(t("notes.x.shareFailed"));
      toast(t("notes.x.shareFailed"), "danger");
    } finally {
      setBusy(null);
    }
  }

  async function runExport(format: ExportFormat) {
    setBusy(format);
    setError(null);
    try {
      await exportNote(note!, format);
      onClose();
    } catch (e) {
      const message = t("notes.x.exportFailed", { reason: e instanceof Error && e.message ? e.message : t("notes.x.failed") });
      setError(message);
      toast(message, "danger");
    } finally {
      setBusy(null);
    }
  }

  let body: ReactNode;
  if (page === "menu") {
    body = (
      <>
        <SheetItem icon={icon(FileText)} label={t("notes.x.open")} onPress={() => { onClose(); onOpenNote(note); }} />
        {canWrite ? (
          <>
            <SheetItem
              icon={icon(note.pinned ? PinOff : Pin, p.gold)}
              label={note.pinned ? t("notes.x.unpin") : t("notes.x.pin")}
              onPress={() => { onClose(); void actions.togglePin(note); }}
            />
            <SheetItem
              icon={icon(note.archived ? ArchiveRestore : Archive)}
              label={note.archived ? t("notes.x.unarchive") : t("notes.x.archive")}
              onPress={() => actions.askArchive(note, { onConfirm: onClose })}
            />
            <SheetItem icon={icon(Palette)} label={t("notes.x.appearance")} trailing={<ForwardChevron />} onPress={() => go("appearance")} />
          </>
        ) : null}
        <SheetItem icon={icon(History)} label={t("notes.x.versions")} trailing={<ForwardChevron />} onPress={() => go("versions")} />
        <SheetDivider />
        <SheetItem icon={icon(Copy)} label={t("notes.x.copy")} onPress={() => void copy()} />
        <SheetItem
          icon={icon(Share2)}
          label={t("notes.x.share")}
          disabled={busy !== null}
          trailing={busy === "share" ? <Spinner /> : null}
          onPress={() => void share()}
        />
        <SheetItem icon={icon(Download)} label={t("notes.x.export")} trailing={<ForwardChevron />} onPress={() => go("export")} />
        {canWrite ? (
          <>
            <SheetDivider />
            <SheetItem
              icon={icon(Trash2, p.danger)}
              label={t("notes.x.delete")}
              tone="danger"
              onPress={() => actions.askDelete(note, { onConfirm: onClose })}
            />
          </>
        ) : null}
      </>
    );
  } else if (page === "appearance") {
    body = (
      <>
        <PageHead label={t("notes.x.appearance")} onBack={() => go("menu")} />
        <AppearancePicker
          note={note}
          onPick={async (patch) => setError(await actions.setAppearance(note, patch))}
        />
      </>
    );
  } else if (page === "versions") {
    body = (
      <>
        <PageHead label={t("notes.x.versions")} onBack={() => go("menu")} />
        <VersionList note={note} open={open} onPick={(version) => go({ version })} />
      </>
    );
  } else if (page === "export") {
    body = (
      <>
        <PageHead label={t("notes.x.export")} onBack={() => go("menu")} />
        {FORMATS.map(({ format, label, Icon }) => (
          <SheetItem
            key={format}
            icon={icon(Icon)}
            label={t(label)}
            disabled={busy !== null && busy !== format}
            trailing={busy === format ? <Spinner /> : null}
            onPress={() => {
              if (busy === null) void runExport(format);
            }}
          />
        ))}
      </>
    );
  } else {
    const v = page.version;
    const current = v.version === note.version;
    body = (
      <>
        <PageHead label={t("notes.x.version", { n: v.version })} onBack={() => go("versions")} />
        <View style={styles.version}>
          <AppText variant="rowTitle">{v.title || t("notes.x.untitled")}</AppText>
          <Meta items={[formatStamp(v.createdAt, locale), v.authorAgent || v.source, v.deleted && t("notes.x.deletedTag")]} />
          <View style={[styles.preview, { borderColor: p.line, backgroundColor: p.bg }]}>
            <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} nestedScrollEnabled contentContainerStyle={{ padding: 12 }}>
              <AppText variant="body" selectable>{v.body || t("notes.x.emptyVersion")}</AppText>
            </ScrollView>
          </View>
          {current ? (
            <Chip label={t("notes.x.current").toUpperCase()} tone="gold" />
          ) : canWrite ? (
            <PrimaryButton
              label={t("notes.x.restore")}
              icon={<RotateCcw size={16} color={p.onAction} strokeWidth={1.8} />}
              loading={busy === "restore"}
              onPress={() =>
                actions.askRestore(note, v.version, {
                  onConfirm: () => setBusy("restore"),
                  onDone: (err) => {
                    setBusy(null);
                    if (err) setError(err);
                    else go("versions");
                  },
                })
              }
            />
          ) : null}
        </View>
      </>
    );
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={note.title.trim() || t("notes.x.untitled")}
      subtitle={`${note.namespace} · ${t("notes.x.updated", { when: formatStamp(note.updatedAt, locale) })}`}
    >
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
        {error ? (
          <View style={{ paddingHorizontal: metrics.padX, paddingVertical: 8 }}>
            <ErrorLine text={error} />
          </View>
        ) : null}
        {body}
      </ScrollView>
    </BottomSheet>
  );
}

/** A sub-page's heading: back toward the menu, and where you are. */
function PageHead({ label, onBack }: { label: string; onBack: () => void }) {
  const p = usePalette();
  const { t } = useI18n();
  const { Back } = useChevrons();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t("notes.x.back")}
      onPress={onBack}
      style={({ pressed }) => [styles.pageHead, { borderBottomColor: p.soft, backgroundColor: pressed ? p.soft : "transparent" }]}
    >
      <Back size={18} color={p.muted} strokeWidth={1.6} />
      <AppText variant="micro">{label.toUpperCase()}</AppText>
    </Pressable>
  );
}

/*
Icon and colour override (MH-308). The choices are the server's allowed set
(NOTE_ICON_NAMES / NOTE_COLORS, pinned to the shared map by the core test);
each tap saves at once, and the sheet reflects the optimistic change. Reset
sends "" for both, which the server reads as "derive from the category".
*/
function AppearancePicker({ note, onPick }: { note: Note; onPick: (patch: { icon?: string; color?: string }) => void }) {
  const p = usePalette();
  const { t } = useI18n();
  const resolved = noteIcon({ category: note.category, icon: note.icon, color: note.color }, p.muted);
  const chosenColor = (note.color ?? "").toLowerCase();

  return (
    <>
      <SheetDivider label={t("notes.x.icon")} />
      <View style={styles.grid}>
        {NOTE_ICON_NAMES.map((name) => {
          const { Icon } = noteIcon({ icon: name }, p.muted);
          const on = note.icon === name;
          return (
            <Pressable
              key={name}
              accessibilityRole="button"
              accessibilityLabel={name}
              accessibilityState={{ selected: on }}
              onPress={() => onPick({ icon: name })}
              style={[styles.cell, { borderColor: on ? p.gold : p.line, backgroundColor: on ? `${p.gold}1A` : p.bg }]}
            >
              <Icon size={19} color={resolved.color} strokeWidth={1.8} />
            </Pressable>
          );
        })}
      </View>
      <SheetDivider label={t("notes.x.colour")} />
      <View style={styles.grid}>
        {NOTE_COLORS.map((hex) => {
          const on = chosenColor === hex;
          return (
            <Pressable
              key={hex}
              accessibilityRole="button"
              accessibilityLabel={hex}
              accessibilityState={{ selected: on }}
              onPress={() => onPick({ color: hex })}
              style={[styles.cell, { borderColor: on ? p.gold : p.line, borderWidth: on ? 2 : 1, backgroundColor: p.bg }]}
            >
              <View style={[styles.swatch, { backgroundColor: hex }]}>
                {on ? <Check size={14} color="#ffffff" strokeWidth={2.4} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      <SheetDivider />
      <SheetItem
        icon={<RotateCcw size={18} color={p.muted} strokeWidth={1.7} />}
        label={t("notes.x.resetAppearance")}
        disabled={!note.icon && !note.color}
        onPress={() => onPick({ icon: "", color: "" })}
      />
    </>
  );
}

/** GET /api/notes/{id}/versions, newest first. Read-only brains can browse it too. */
function VersionList({ note, open, onPick }: { note: Note; open: boolean; onPick: (v: NoteVersion) => void }) {
  const { token } = useAuth();
  const { t, locale } = useI18n();
  const q = useQuery({
    queryKey: noteKeys.versions(note.namespace, note.id),
    queryFn: ({ signal }) => notesApi.versions(token!, note.id, signal),
    enabled: open && !!token,
  });

  if (q.isPending) {
    return (
      <View style={styles.pad}>
        <Spinner />
      </View>
    );
  }
  if (q.error) {
    return (
      <View style={styles.pad}>
        <ErrorLine text={q.error.message || t("notes.x.failed")} />
        <TextButton label={t("kit.retry")} onPress={() => void q.refetch()} />
      </View>
    );
  }
  const list = [...(q.data?.versions ?? [])].sort((a, b) => b.version - a.version);
  if (list.length <= 1) {
    return (
      <View style={styles.pad}>
        <AwaitNote text={t("notes.x.versionsEmpty")} />
      </View>
    );
  }
  return (
    <>
      {list.map((v) => (
        <SheetItem
          key={v.version}
          label={`${t("notes.x.version", { n: v.version })} · ${v.title || t("notes.x.untitled")}`}
          detail={[formatStamp(v.createdAt, locale), v.authorAgent || v.source, v.deleted ? t("notes.x.deletedTag") : ""].filter(Boolean).join(" · ")}
          trailing={v.version === note.version ? <Chip label={t("notes.x.current").toUpperCase()} tone="gold" /> : <ForwardChevron />}
          onPress={() => onPick(v)}
        />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  pageHead: { minHeight: 44, paddingHorizontal: metrics.padX, flexDirection: "row", alignItems: "center", gap: 8, borderBottomWidth: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: metrics.padX, paddingVertical: 10 },
  cell: { width: metrics.touch, height: metrics.touch, borderRadius: metrics.radius.control, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  swatch: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  version: { paddingHorizontal: metrics.padX, paddingTop: 12, gap: 10 },
  preview: { maxHeight: 280, borderWidth: 1, borderRadius: metrics.radius.control, overflow: "hidden" },
  pad: { paddingHorizontal: metrics.padX, paddingVertical: 16, gap: 8, alignItems: "flex-start" },
});
