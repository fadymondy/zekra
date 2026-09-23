import { useState } from "react";
import { Image, View } from "react-native";

import { AppText } from "@/components/ui";
import { brainHex, monogram } from "@/features/brains/brains-core";
import type { Brain } from "@/lib/api";
import { useAuthedSource } from "@/lib/authed";
import { fonts, usePalette } from "@/theme";

type AvatarBrain = Pick<Brain, "namespace"> & Partial<Pick<Brain, "displayName" | "icon" | "colorHex" | "color" | "imageUrl">>;

/**
 * A brain's identity tile — the web's BrainAvatar (web/components/brains/
 * brain-cells.tsx) in the mobile tile shape: its avatar image when it has one
 * (auth-gated, so the bearer rides along); otherwise a hairline square with
 * its emoji icon or a two-letter mono monogram on a 14% tint of the brain's
 * colour, with the colour as the memory square in the corner. Never mirrored.
 */
export function BrainAvatar({ brain, size = 38 }: { brain?: AvatarBrain; size?: number }) {
  const p = usePalette();
  const source = useAuthedSource(brain?.imageUrl);
  const [broken, setBroken] = useState(false);
  const hex = brain ? brainHex(brain) : "";
  const radius = size >= 30 ? 8 : 6;
  const dot = Math.max(6, Math.round(size * 0.18));

  if (source && !broken) {
    return (
      <Image
        source={source}
        onError={() => setBroken(true)}
        accessibilityIgnoresInvertColors
        style={{ width: size, height: size, borderRadius: radius, borderWidth: 1, borderColor: p.line, backgroundColor: p.soft }}
      />
    );
  }

  const icon = brain?.icon?.trim();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        borderWidth: 1,
        borderColor: p.line,
        // 0x24 ≈ 14%, the web's color-mix(… 14%, transparent).
        backgroundColor: hex ? `${hex}24` : p.soft,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {icon ? (
        <AppText style={{ fontSize: Math.round(size * 0.5), lineHeight: Math.round(size * 0.66) }}>{icon}</AppText>
      ) : (
        <AppText style={{ fontFamily: fonts.monoMedium, fontSize: Math.max(9, Math.round(size * 0.3)), color: p.ink, writingDirection: "ltr" }}>
          {monogram(brain?.namespace ?? "")}
        </AppText>
      )}
      <View style={{ position: "absolute", top: -1, end: -1, width: dot, height: dot, backgroundColor: hex || p.action, borderTopEndRadius: radius > 6 ? 3 : 2 }} />
    </View>
  );
}
