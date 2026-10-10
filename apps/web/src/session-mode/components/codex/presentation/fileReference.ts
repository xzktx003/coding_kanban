export type FileReference = { path: string; line?: number; column?: number };

/** Protocol paths are literal filesystem names, not Markdown URLs or :line links. */
export function resolveLiteralFilePath(
  value: string,
  cwd?: string | null,
): string | null {
  if (
    !value ||
    /[\u0000-\u001f]/.test(value) ||
    /^(?:[a-z][a-z\d+.-]*:\/\/|javascript:|data:|mailto:)/i.test(value)
  )
    return null;
  const absolute =
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[a-z]:[\\/]/i.test(value);
  if (!absolute) {
    if (!cwd) return null;
    value = cwd.replace(/[\\/]+$/, "") + "/" + value;
  }
  const windows = /^[a-z]:[\\/]/i.test(value) || value.startsWith("\\");
  const prefix = value.startsWith("\\\\")
    ? "\\\\"
    : value.startsWith("/")
      ? "/"
      : "";
  const parts: string[] = [];
  for (const part of (windows ? value.replace(/\\/g, "/") : value).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length && !/^[a-z]:$/i.test(parts.at(-1)!)) parts.pop();
    } else parts.push(part);
  }
  return prefix + parts.join(windows ? "\\" : "/");
}

/** Native file references may carry :line:column or #Lline, including Windows paths. */
export function parseFileReference(
  href: string,
  cwd?: string | null,
): FileReference | null {
  let value: string;
  try {
    value = decodeURIComponent(href.trim());
  } catch {
    return null;
  }
  if (!value || /[\u0000-\u001f]/.test(value) || value.startsWith("#"))
    return null;
  if (/^file:\/\//i.test(value)) {
    // An unrecognized authority cannot silently become a local file.
    value = value.replace(/^file:\/\/localhost(?=\/)/i, "file://");
    const rest = value.slice(7);
    if (!rest.startsWith("/") && !/^[a-z]:[\\/]/i.test(rest)) return null;
    value = rest.replace(/^\/([a-z]:[\\/])/i, "$1");
  } else if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value))
    return null;
  const fragment = value.match(/#L(\d+)(?:C(\d+))?(?:-L?\d+(?:C\d+)?)?$/i);
  const suffix = fragment ? null : value.match(/:(\d+)(?::(\d+))?(?:-\d+)?$/);
  const location = fragment ?? suffix;
  let path = location
    ? value.slice(0, location.index)
    : value.split(/[?#]/, 1)[0];
  if (!path) return null;
  const absolute =
    path.startsWith("/") || path.startsWith("\\") || /^[a-z]:[\\/]/i.test(path);
  if (!absolute) {
    if (!cwd) return null;
    path = cwd.replace(/[\\/]+$/, "") + "/" + path.replace(/^\.\//, "");
  }
  const windows = /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\");
  const separator = windows ? "\\" : "/";
  const prefix = path.startsWith("\\\\")
    ? "\\\\"
    : path.startsWith("/")
      ? "/"
      : "";
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length && !/^[a-z]:$/i.test(parts.at(-1)!)) parts.pop();
    } else parts.push(part);
  }
  path = prefix + parts.join(separator);
  const line = location ? Number(location[1]) : undefined;
  const column = location?.[2] ? Number(location[2]) : undefined;
  if (
    (line !== undefined && (!Number.isSafeInteger(line) || line < 1)) ||
    (column !== undefined && (!Number.isSafeInteger(column) || column < 1))
  )
    return null;
  return { path, ...(line ? { line } : {}), ...(column ? { column } : {}) };
}
