/** Same minimum as the VSIX mcpOauthLoginThreadId capability. Unknown is unsupported. */
export function mcpOAuthThreadIdSupported(userAgent: unknown): boolean {
  if (typeof userAgent !== "string") return false;
  const m = /(?:^|\/)\s*(\d+)\.(\d+)\.(\d+)(?:-alpha\.(\d+))?(?=\s|\(|$)/.exec(
    userAgent,
  );
  if (!m) return false;
  const major = Number(m[1]),
    minor = Number(m[2]),
    patch = Number(m[3]);
  return (
    major > 0 ||
    minor > 143 ||
    (minor === 143 && (patch > 0 || !m[4] || Number(m[4]) >= 26))
  );
}
