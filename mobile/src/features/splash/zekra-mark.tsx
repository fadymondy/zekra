import Svg, { Rect } from "react-native-svg";

import { CELLS, GOLD, UNIT, VIEWBOX, VIOLET } from "@/features/splash/splash-core";

/**
 * The Zekra cube mark: a gold dome cell over seven violet cells. Square cells,
 * no stroke, never mirrored under RTL. `size` is the side of the square box
 * (the lattice fills 92% of it, as in web/public/site/icon.svg and the native
 * splash image). `tight` crops to the lattice for inline use.
 */
export function ZekraMark({ size = 32, tight = false }: { size?: number; tight?: boolean }) {
  const box = tight ? { x: 4, y: 13.2, w: 92, h: 73.6 } : { x: 0, y: 0, w: VIEWBOX, h: VIEWBOX };
  return (
    <Svg width={size} height={(size * box.h) / box.w} viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {CELLS.map((c) => (
        <Rect key={`${c.col}-${c.row}`} x={c.x} y={c.y} width={UNIT} height={UNIT} fill={c.gold ? GOLD : VIOLET} />
      ))}
    </Svg>
  );
}
