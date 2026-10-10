import { homedir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";
import { HttpError } from "../core/json.js";

export function absolutePath(input: unknown, home = homedir()): string {
  if (typeof input !== "string" || !input || /[\x00-\x1f]/.test(input))
    throw new HttpError(400, "Invalid path");
  const expanded =
    input === "~"
      ? home
      : input.startsWith("~/")
        ? join(home, input.slice(2))
        : input;
  if (!isAbsolute(expanded)) throw new HttpError(400, "Path must be absolute");
  return normalize(expanded);
}
