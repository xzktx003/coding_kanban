import { lstat, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

type Budget = { entries: number; limit: number };
/** Quota fallback: metadata only, bounded traversal and stat concurrency. */
export async function pollingFileWatcher(
  directory: string,
  options: {
    file?: string;
    intervalMs: number;
    budget: Budget;
    changed: (kind: "rename" | "change", name: string) => void;
    error: (error: Error) => void;
  },
) {
  const scan = async () => {
    const names = options.file
      ? [basename(options.file)]
      : await readdir(directory).catch((error) => {
          if (error.code === "ENOENT") return [];
          throw error;
        });
    if (names.length > options.budget.limit)
      throw new Error("File watch polling entry limit exceeded");
    const entries = new Map<string, string>();
    for (let offset = 0; offset < names.length; offset += 8) {
      await Promise.all(
        names.slice(offset, offset + 8).map(async (name) => {
          try {
            const info = await lstat(join(directory, name));
            entries.set(
              name,
              `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}:${info.mode}`,
            );
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }),
      );
    }
    return entries;
  };
  let previous = await scan();
  if (options.budget.entries + previous.size > options.budget.limit)
    throw new Error("File watch polling entry limit exceeded");
  options.budget.entries += previous.size;
  let closed = false,
    busy = false;
  let timer: ReturnType<typeof setInterval>;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    options.budget.entries -= previous.size;
    previous.clear();
  };
  const update = async () => {
    if (closed || busy) return;
    busy = true;
    try {
      const next = await scan();
      if (closed) return;
      const total = options.budget.entries - previous.size + next.size;
      if (total > options.budget.limit)
        throw new Error("File watch polling entry limit exceeded");
      options.budget.entries = total;
      const old = previous;
      previous = next;
      for (const [name, signature] of next) {
        if (!old.has(name)) options.changed("rename", name);
        else if (old.get(name) !== signature) options.changed("change", name);
      }
      for (const name of old.keys())
        if (!next.has(name)) options.changed("rename", name);
    } catch (error) {
      if (!closed) {
        close();
        options.error(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    } finally {
      busy = false;
    }
  };
  timer = setInterval(() => void update(), options.intervalMs);
  timer.unref();
  return { close };
}
