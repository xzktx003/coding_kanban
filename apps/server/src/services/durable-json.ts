import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

async function atomicWrite(file: string, content: string) {
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temp, "wx", 0o600);
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, file);
    const directory = await open(dirname(file), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await unlink(temp).catch(() => {});
  }
}
/** Callers serialize and validate primary records before saving. Never overwrite a corrupt primary. */
export async function writeDurableJson(file: string, value: unknown) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  let previous: string | undefined;
  try {
    previous = await readFile(file, "utf8");
    JSON.parse(previous);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  if (previous !== undefined) await atomicWrite(`${file}.bak`, previous);
  await atomicWrite(file, JSON.stringify(value));
}
