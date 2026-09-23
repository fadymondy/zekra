// The Zekra cube mark, rendered from the canonical cell geometry in
// web/app/styles/grid-marks.ts (PRODUCT_MARKS.zekra): 8 cells on a 5x4
// lattice with [3,0] carrying the gold accent. Colours come from the grid
// tokens so it follows the theme.
const CELLS: [number, number][] = [
  [3, 0],
  [2, 1],
  [4, 1],
  [1, 2],
  [3, 2],
  [5, 2],
  [2, 3],
  [4, 3],
];
const ACCENT = "3,0";
const COLS = 5;
const ROWS = 4;
const UNIT = 10;
const MIN_COL = 1;

export function ZekraMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={(size / COLS) * ROWS}
      viewBox={`0 0 ${COLS * UNIT} ${ROWS * UNIT}`}
      className={className}
      role="img"
      aria-label="Zekra"
    >
      {CELLS.map(([col, row]) => (
        <rect
          key={`${col},${row}`}
          x={(col - MIN_COL) * UNIT}
          y={row * UNIT}
          width={UNIT}
          height={UNIT}
          fill={`${col},${row}` === ACCENT ? "var(--grid-brand-accent)" : "var(--grid-brand)"}
        />
      ))}
    </svg>
  );
}
