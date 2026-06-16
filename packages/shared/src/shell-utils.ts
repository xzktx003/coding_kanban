/**
 * Shell utility functions shared between frontend and backend.
 *
 * These functions were previously duplicated in:
 * - apps/web/src/lib/session-matching.ts
 * - apps/server/src/routes/agent-sessions.ts
 * - apps/web/src/components/QuickTmuxConnect.tsx
 */

/**
 * Quote a value for safe inclusion in a POSIX shell command.
 * Wraps in single quotes and escapes any embedded single quotes.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Format a working directory for use in shell commands.
 * Handles ~ and ~/... paths with proper quoting, and quotes absolute/relative paths.
 */
export function formatWorkingDirectory(workingDirectory: string): string {
  if (workingDirectory === "~" || workingDirectory === "~/") {
    return "~";
  }

  if (workingDirectory.startsWith("~/")) {
    const suffix = workingDirectory
      .slice(2)
      .split("/")
      .filter(Boolean)
      .map((segment) => shellQuote(segment))
      .join("/");

    return suffix ? `~/${suffix}` : "~";
  }

  return shellQuote(workingDirectory);
}
