import {
  Archive,
  ArchiveRestore,
  BookOpen,
  Download,
  FileCode2,
  FileImage,
  FileText,
  FileType,
  Hash,
  Pin,
  PinOff,
  Share2,
  Tag,
  Trash2,
  X,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { BottomSheet, SheetDivider, SheetItem, Spinner } from "@/components/kit";
import { ReadingSettings } from "@/components/reading-settings";
import { AppText, Field, PrimaryButton, SecondaryButton } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { fonts, metrics, usePalette } from "@/theme";

import type { ExportFormat } from "./export";

/*
Sheets for the note screen's ⋯ menu (MH-368). The notes-list workstream owns
the row actions sheet; this is the note screen's own, smaller set.
*/

export function NoteMenuSheet({ open, onClose, canWrite, saved, pinned, archived, onReading, onTags, onPin, onArchive, onExport, onShare, onDelete }: {
  open: boolean;
  onClose: () => void;
  canWrite: boolean;
  /** Whether the note exists on the server yet (a new, empty note does not). */
  saved: boolean;
  pinned: boolean;
  archived: boolean;
  onReading: () => void;
  onTags: () => void;
  onPin: () => void;
  onArchive: () => void;
  onExport: () => void;
  onShare: () => void;
  onDelete: () => void;
}) {
  const p = usePalette();
  const { t } = useI18n();
  const icon = (I: typeof Pin, color = p.muted) => <I size={19} color={color} strokeWidth={1.7} />;
  return (
    <BottomSheet open={open} onClose={onClose} title={t("editor.menuTitle")}>
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} bounces={false}>
        <SheetItem icon={icon(BookOpen)} label={t("editor.readingSettings")} onPress={onReading} />
        {canWrite ? <SheetItem icon={icon(Tag)} label={t("editor.tags")} onPress={onTags} /> : null}
        {canWrite ? (
          <SheetItem icon={icon(pinned ? PinOff : Pin, p.gold)} label={t(pinned ? "row.unpin" : "row.pin")} disabled={!saved} onPress={onPin} />
        ) : null}
        {canWrite ? (
          <SheetItem icon={icon(archived ? ArchiveRestore : Archive)} label={t(archived ? "row.unarchive" : "row.archive")} disabled={!saved} onPress={onArchive} />
        ) : null}
        <SheetDivider />
        <SheetItem icon={icon(Download)} label={t("editor.export")} onPress={onExport} />
        <SheetItem icon={icon(Share2)} label={t("editor.share")} onPress={onShare} />
        {canWrite ? (
          <>
            <SheetDivider />
            <SheetItem icon={icon(Trash2, p.danger)} label={t("note.delete")} tone="danger" onPress={onDelete} />
          </>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

export function ReadingSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <BottomSheet open={open} onClose={onClose} title={t("editor.readingSettings")} maxHeight={0.9}>
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: metrics.padX, paddingBottom: 12 }}>
        <ReadingSettings />
      </ScrollView>
    </BottomSheet>
  );
}

const FORMATS: { format: ExportFormat; icon: typeof Hash }[] = [
  { format: "md", icon: Hash },
  { format: "pdf", icon: Download },
  { format: "docx", icon: FileType },
  { format: "html", icon: FileCode2 },
  { format: "png", icon: FileImage },
  { format: "txt", icon: FileText },
];

export function ExportSheet({ open, onClose, busy, onPick }: {
  open: boolean;
  onClose: () => void;
  busy: ExportFormat | null;
  onPick: (format: ExportFormat) => void;
}) {
  const p = usePalette();
  const { t } = useI18n();
  return (
    <BottomSheet open={open} onClose={onClose} title={t("editor.export")}>
      <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} bounces={false}>
        {FORMATS.map(({ format, icon: I }) => (
          <SheetItem
            key={format}
            icon={<I size={19} color={p.muted} strokeWidth={1.7} />}
            label={t(`editor.export.${format}`)}
            disabled={busy !== null}
            onPress={() => onPick(format)}
            trailing={busy === format ? <Spinner /> : undefined}
          />
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

/** Tags as removable chips + an add field. Enter or a comma adds. */
export function TagsSheet({ open, onClose, tags, onChange }: {
  open: boolean;
  onClose: () => void;
  tags: string[];
  onChange: (tags: string[]) => void;
}) {
  const p = usePalette();
  const { t } = useI18n();
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (!open) setDraft("");
  }, [open]);

  const add = (raw: string) => {
    const next = raw
      .split(",")
      .map((s) => s.trim().replace(/^#/, ""))
      .filter(Boolean)
      .filter((tag) => !tags.includes(tag));
    if (next.length) onChange([...tags, ...Array.from(new Set(next))]);
    setDraft("");
  };

  return (
    <BottomSheet open={open} onClose={onClose} title={t("editor.tags")}>
      <View style={{ paddingHorizontal: metrics.padX, gap: 14, paddingBottom: 8 }}>
        <View style={styles.chips}>
          {tags.length === 0 ? <AppText variant="meta">{t("editor.tagsNone")}</AppText> : null}
          {tags.map((tag) => (
            <Pressable
              key={tag}
              accessibilityRole="button"
              accessibilityLabel={t("editor.tagRemove", { tag })}
              onPress={() => onChange(tags.filter((x) => x !== tag))}
              style={[styles.chip, { borderColor: `${p.gold}66`, backgroundColor: `${p.gold}14` }]}
            >
              <AppText style={{ fontFamily: fonts.mono, fontSize: 12, color: p.gold }}>#{tag}</AppText>
              <X size={13} color={p.gold} strokeWidth={2} />
            </Pressable>
          ))}
        </View>
        <Field
          value={draft}
          onChangeText={(v) => (v.includes(",") ? add(v) : setDraft(v))}
          placeholder={t("editor.tagAdd")}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          submitBehavior="submit"
          onSubmitEditing={() => add(draft)}
        />
        <PrimaryButton label={t("common.close")} onPress={() => { add(draft); onClose(); }} />
      </View>
    </BottomSheet>
  );
}

/** Link editor for the toolbar: set, change or remove the link at the caret. */
export function LinkSheet({ open, onClose, initial, onApply }: {
  open: boolean;
  onClose: () => void;
  initial: string;
  onApply: (href: string) => void;
}) {
  const { t } = useI18n();
  const [href, setHref] = useState(initial);
  useEffect(() => {
    if (open) setHref(initial);
  }, [open, initial]);
  const normalised = () => {
    const v = href.trim();
    if (!v) return "";
    return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
  };
  return (
    <BottomSheet open={open} onClose={onClose} title={t("editor.linkTitle")}>
      <View style={{ paddingHorizontal: metrics.padX, gap: 12, paddingBottom: 8 }}>
        <Field
          value={href}
          onChangeText={setHref}
          placeholder={t("editor.linkPlaceholder")}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          autoFocus
          style={{ textAlign: "left", writingDirection: "ltr" }}
          onSubmitEditing={() => onApply(normalised())}
        />
        <PrimaryButton label={t("editor.linkApply")} onPress={() => onApply(normalised())} disabled={!href.trim()} />
        {initial ? <SecondaryButton label={t("editor.linkRemove")} tone="danger" onPress={() => onApply("")} /> : null}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, minHeight: 28, alignItems: "center" },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 30, paddingHorizontal: 10, borderRadius: metrics.radius.chip, borderWidth: 1 },
});
