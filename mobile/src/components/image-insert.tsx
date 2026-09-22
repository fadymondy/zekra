import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { ImagePlus, Loader } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, StyleSheet } from "react-native";

import { AppText } from "@/components/ui";
import { useI18n } from "@/lib/i18n";
import { uploadNoteImage } from "@/lib/api";
import { metrics, usePalette } from "@/theme";

/*
Insert an image into a note (MH-319 item 3).

The web and desktop editors upload on paste or drop. Neither gesture exists on
a phone, so the equivalent is offered explicitly: an image already on the
clipboard is used if there is one, otherwise the library opens. Checking the
clipboard FIRST is what makes "copy a screenshot, paste it into the note" work,
which is the behaviour being ported.

The endpoint is the same content-addressed one the other clients use, so the
same image uploaded twice costs one blob.
*/
export function ImageInsertButton({
  token,
  namespace,
  onInsert,
}: {
  token: string;
  namespace: string;
  onInsert: (markdown: string) => void;
}) {
  const p = usePalette();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  async function pick(): Promise<{ uri: string; name: string; type: string } | null> {
    // A clipboard image is a data URI; upload it as a PNG, which is what the
    // system pasteboard hands over for a screenshot.
    if (await Clipboard.hasImageAsync()) {
      const image = await Clipboard.getImageAsync({ format: "png" });
      if (image?.data) return { uri: image.data, name: "pasted.png", type: "image/png" };
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
    });
    if (result.canceled || !result.assets?.length) return null;
    const asset = result.assets[0];
    return {
      uri: asset.uri,
      name: asset.fileName || "image.jpg",
      // SVG is rejected server-side (it executes script in our origin), and the
      // picker cannot return one, so a missing mime defaults to JPEG.
      type: asset.mimeType || "image/jpeg",
    };
  }

  async function run() {
    setBusy(true);
    try {
      const file = await pick();
      if (!file) return;
      const { url } = await uploadNoteImage(token, namespace, file);
      onInsert(`\n![](${url})\n`);
    } catch (error) {
      Alert.alert(t("note.imageFailed"), error instanceof Error ? error.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Pressable
      onPress={() => void run()}
      disabled={busy}
      accessibilityLabel={t("note.insertImage")}
      style={[styles.button, { borderColor: p.line, opacity: busy ? 0.5 : 1 }]}
    >
      {busy ? <Loader color={p.muted} size={15} /> : <ImagePlus color={p.action} size={15} />}
      <AppText variant="micro">{t("note.insertImage")}</AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: metrics.radius.chip,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
});
