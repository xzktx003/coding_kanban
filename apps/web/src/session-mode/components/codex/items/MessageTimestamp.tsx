type Timestamp = { ms: number; label: string };
const valid = (ms: number | undefined): ms is number =>
  typeof ms === "number" && ms > 0 && Number.isFinite(new Date(ms).getTime());

/** Native item times are milliseconds; historical turn times are explicitly labelled. */
export function MessageTimestamp({
  ms,
  fallback,
  alignEnd = false,
}: {
  ms?: number;
  fallback?: Timestamp;
  alignEnd?: boolean;
}) {
  const value = valid(ms) ? { ms, label: "" } : fallback;
  if (!value || !valid(value.ms)) return null;
  const date = new Date(value.ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const text = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return (
    <div
      className={`mt-1 text-xs text-muted-foreground tabular-nums ${alignEnd ? "text-right" : "text-left"}`}
    >
      <time
        dateTime={date.toISOString()}
        title={`${text} · ${Intl.DateTimeFormat().resolvedOptions().timeZone}`}
      >
        {value.label ? `${value.label} · ` : ""}
        {text}
      </time>
    </div>
  );
}
