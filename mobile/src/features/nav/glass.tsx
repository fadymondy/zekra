import { GlassContainer, GlassView } from "expo-glass-effect";
import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

import { hasGlassEffect } from "@/lib/platform";
import { useTheme } from "@/theme";

// Liquid Glass surfaces for the iOS 26+ chrome (MH-360). Only rendered when
// isLiquidGlass() — callers gate on that; this file additionally falls back to
// a translucent card when the runtime can't draw real glass (app opted out via
// UIDesignRequiresCompatibility, an old binary, Reduce Transparency is handled
// by the system itself).

/**
 * A glass surface. `tint` colours the glass (the violet primary action);
 * `interactive` gives the native press response (scale + shimmer). The shape
 * comes from `style` (borderRadius) — GlassView reads it natively.
 */
export function GlassSurface({ children, style, tint, interactive, pointerEvents }: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  tint?: string;
  interactive?: boolean;
  pointerEvents?: "box-none" | "none" | "box-only" | "auto";
}) {
  const { scheme, palette: p } = useTheme();
  if (hasGlassEffect()) {
    return (
      <GlassView
        glassEffectStyle="regular"
        colorScheme={scheme}
        tintColor={tint}
        isInteractive={interactive}
        pointerEvents={pointerEvents}
        style={style}
      >
        {children}
      </GlassView>
    );
  }
  return (
    <View pointerEvents={pointerEvents} style={[{ backgroundColor: tint ?? `${p.card}E6`, borderWidth: tint ? 0 : 0.5, borderColor: p.line }, style]}>
      {children}
    </View>
  );
}

/** Groups adjacent glass controls so they blend and morph together. */
export function GlassGroup({ children, spacing = 9, style }: { children: ReactNode; spacing?: number; style?: StyleProp<ViewStyle> }) {
  if (!hasGlassEffect()) return <View style={style}>{children}</View>;
  return (
    <GlassContainer spacing={spacing} style={style}>
      {children}
    </GlassContainer>
  );
}
