import type { ReasoningEffort } from "@session/bindings";

/** Step through the catalog efforts. Cycle wraps; raise and lower stop at the ends. */
export function stepReasoningEffort(
  options: ReasoningEffort[],
  current: ReasoningEffort | null | undefined,
  direction: 1 | -1,
  wrap: boolean,
) {
  if (options.length < 2) return null;
  const index = options.indexOf(current as ReasoningEffort);
  const start = index < 0 ? (direction > 0 ? -1 : 1) : index;
  const next = start + direction;
  if (wrap) return options[(next + options.length) % options.length];
  if (next < 0 || next >= options.length) return options[Math.max(0, Math.min(options.length - 1, start))];
  return options[next];
}
