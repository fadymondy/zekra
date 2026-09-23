import { Check, Plus } from "lucide-react-native";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { BottomSheet, ErrorLine, toast } from "@/components/kit";
import { AppText, Field, PrimaryButton } from "@/components/ui";
import { BrainAvatar } from "@/features/brains/brain-avatar";
import { brainsApi, useInvalidateBrains } from "@/features/brains/brain-data";
import { clampIcon, PALETTE, slugify, validNamespace } from "@/features/brains/brains-core";
import { ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/providers/auth";
import { fonts, metrics, usePalette } from "@/theme";

function Swatches({ value, onChange }: { value: string; onChange: (key: string) => void }) {
  const p = usePalette();
  const { t } = useI18n();
  return (
    <View style={styles.swatches} accessibilityRole="radiogroup">
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={t("brains.new.colorNone")}
        accessibilityState={{ checked: value === "" }}
        onPress={() => onChange("")}
        style={[styles.ring, { borderColor: value === "" ? p.action : "transparent" }]}
      >
        <View style={[styles.swatch, { backgroundColor: p.card, borderWidth: 1, borderColor: p.line, alignItems: "center", justifyContent: "center" }]}>
          <View style={{ width: 18, height: 1.5, backgroundColor: p.muted, transform: [{ rotate: "-45deg" }] }} />
        </View>
      </Pressable>
      {PALETTE.map((c) => {
        const on = value === c.key;
        return (
          <Pressable
            key={c.key}
            accessibilityRole="radio"
            accessibilityLabel={c.key}
            accessibilityState={{ checked: on }}
            onPress={() => onChange(c.key)}
            style={[styles.ring, { borderColor: on ? p.action : "transparent" }]}
          >
            <View style={[styles.swatch, { backgroundColor: c.hex, alignItems: "center", justifyContent: "center" }]}>
              {on ? <Check size={14} color="#ffffff" strokeWidth={2.4} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * New brain (the web's NewBrainDialog, as a bottom sheet): name → namespace
 * (auto-slugged, editable), description, colour, emoji icon. Claims the brain
 * with POST /api/brain/brains, then — like the web — retains a first marker
 * memory so it exists and is connectable, and opens it.
 */
export function NewBrainSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (ns: string) => void }) {
  const p = usePalette();
  const { t } = useI18n();
  const { token } = useAuth();
  const invalidate = useInvalidateBrains();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [desc, setDesc] = useState("");
  const [color, setColor] = useState("");
  const [icon, setIcon] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const namespace = slugEdited ? slug : slugify(name);
  const nsOk = validNamespace(namespace);

  useEffect(() => {
    if (open) return;
    setName("");
    setSlug("");
    setSlugEdited(false);
    setDesc("");
    setColor("");
    setIcon("");
    setError(null);
  }, [open]);

  async function create() {
    if (!token || !nsOk || busy) return;
    setBusy(true);
    setError(null);
    const displayName = name.trim();
    const description = desc.trim();
    const glyph = clampIcon(icon);
    try {
      try {
        await brainsApi.create(token, {
          namespace,
          ...(displayName && displayName !== namespace ? { displayName } : {}),
          ...(color ? { color } : {}),
          ...(description ? { description } : {}),
          ...(glyph ? { icon: glyph } : {}),
        });
      } catch (err) {
        // A deployment without session claims answers 403; the retain below still materialises the brain (web parity).
        if (!(err instanceof ApiError && err.status === 403)) throw err;
      }
      await brainsApi.retain(token, {
        namespace,
        content: `Brain "${displayName || namespace}" created from the mobile app.${description ? " " + description : ""}`,
        sourceKind: "system",
        sourceRef: "mobile/new-brain",
      });
      await invalidate();
      toast(t("brains.new.created", { brain: displayName || namespace }), "ok");
      onClose();
      onCreated(namespace);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setError(t("brains.new.exists"));
      else if (err instanceof ApiError && err.status === 400) setError(t("brains.new.invalid"));
      else if (err instanceof ApiError && err.status === 0) setError(t("brains.error.network"));
      else setError(err instanceof Error ? err.message : t("brains.error.network"));
    } finally {
      setBusy(false);
    }
  }

  const optional = (label: string) => `${label} · ${t("brains.new.optional")}`;

  return (
    <BottomSheet open={open} onClose={onClose} title={t("brains.new.title")} maxHeight={0.92}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
          <AppText style={{ fontFamily: fonts.light, fontSize: 14.5, lineHeight: 25, color: p.muted }}>{t("brains.new.description")}</AppText>

          <Field
            label={t("brains.new.name")}
            value={name}
            onChangeText={setName}
            maxLength={80}
            placeholder={t("brains.new.namePlaceholder")}
            returnKeyType="next"
            icon={<BrainAvatar brain={{ namespace: namespace || "··", color, icon: clampIcon(icon) }} size={26} />}
          />

          <Field
            label={t("brains.new.namespace")}
            value={namespace}
            onChangeText={(v) => {
              setSlugEdited(true);
              setSlug(v.toLowerCase().replace(/\s+/g, "-"));
            }}
            ltr
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={63}
            placeholder="research"
            style={{ fontFamily: fonts.mono, fontSize: 15.5 }}
            hint={namespace && !nsOk ? undefined : t("brains.new.namespaceHint")}
          />
          {namespace && !nsOk ? <ErrorLine text={t("brains.new.namespaceInvalid")} /> : null}

          <Field
            label={optional(t("brains.new.descriptionLabel"))}
            value={desc}
            onChangeText={setDesc}
            multiline
            maxLength={2000}
            placeholder={t("brains.new.descriptionPlaceholder")}
          />

          <View style={{ gap: 8 }}>
            <AppText style={{ fontFamily: fonts.medium, fontSize: 12.5, lineHeight: 19, color: p.muted }}>{optional(t("brains.new.color"))}</AppText>
            <Swatches value={color} onChange={setColor} />
          </View>

          <Field
            label={optional(t("brains.new.icon"))}
            value={icon}
            onChangeText={(v) => setIcon(clampIcon(v))}
            placeholder={t("brains.new.iconPlaceholder")}
            autoCorrect={false}
          />

          {error ? <ErrorLine text={error} /> : null}

          <PrimaryButton
            label={t("brains.new.submit")}
            icon={<Plus size={18} color={p.onAction} strokeWidth={1.8} />}
            loading={busy}
            disabled={!nsOk}
            onPress={() => void create()}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: metrics.padX, paddingTop: 4, paddingBottom: 16, gap: 14 },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  ring: { width: 38, height: 38, borderRadius: 8, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  swatch: { width: 28, height: 28, borderRadius: 6 },
});
