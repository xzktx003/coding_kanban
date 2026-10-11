/** Bounded authentication metadata; tool results and challenge header bodies stay private. */
export interface NativeMcpAuthChallenge {
  scopes: string[];
  truncated?: true;
}
export function mcpAuthChallenge(
  value: unknown,
): NativeMcpAuthChallenge | undefined {
  if (typeof value !== "string" && !Array.isArray(value)) return;
  const headers = typeof value === "string" ? [value] : value;
  if (
    !headers.length ||
    headers.some((v) => typeof v !== "string" || !v.length)
  )
    return;
  if (headers.length > 32 || headers.some((v) => v.length > 4096))
    return { scopes: [], truncated: true };
  const scopes = [
    ...new Set(
      headers.flatMap((h) => {
        const m = /\bscope=(?:"([^"]+)"|([^,\s]+))/i.exec(h);
        return (m?.[1] ?? m?.[2])?.split(/\s+/).filter(Boolean) ?? [];
      }),
    ),
  ];
  if (
    scopes.length > 32 ||
    scopes.some((s) => s.length > 256) ||
    scopes.join(" ").length > 2048
  )
    return { scopes: [], truncated: true };
  return { scopes };
}
