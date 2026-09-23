import { clampPercent } from "../../../shared/update-format";

/** A small determinate ring (the sidebar loader); indeterminate spins. */
export function ProgressRing({ value, size = 14, stroke = 2, indeterminate }: {
  value?: number;
  size?: number;
  stroke?: number;
  indeterminate?: boolean;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = indeterminate ? 28 : clampPercent(value);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={indeterminate ? "shrink-0 animate-spin" : "shrink-0 -rotate-90"}
      aria-hidden
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeOpacity={0.2} strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct / 100)}
        style={{ transition: indeterminate ? undefined : "stroke-dashoffset 300ms ease-out" }}
      />
    </svg>
  );
}
