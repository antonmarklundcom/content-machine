import { sparklinePoints } from "@/lib/results/aggregate";

/** A plain inline-SVG sparkline (build 4 §3.G): no chart library, no axes. */
export function ResultsSparkline({
  values,
  label,
  width = 120,
  height = 28,
}: {
  values: number[];
  label: string;
  width?: number;
  height?: number;
}) {
  const points = sparklinePoints(values, width, height);
  if (!points) return null;
  const last = points.split(" ").at(-1)!.split(",");
  return (
    <svg
      role="img"
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="overflow-visible text-[var(--color-accent)]"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r={2.5} fill="currentColor" />
    </svg>
  );
}
