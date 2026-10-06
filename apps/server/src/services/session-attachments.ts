import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";

export async function saveSessionAttachment(
  root: string,
  input: { name: string; data: string },
): Promise<string> {
  if (
    typeof input.name !== "string" ||
    !input.name ||
    input.name.length > 200 ||
    /[\\/\x00-\x1f]/.test(input.name)
  )
    throw new Error("Invalid attachment name");
  if (
    typeof input.data !== "string" ||
    input.data.length > 14 * 1024 * 1024 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      input.data,
    )
  )
    throw new Error("Invalid or excessive attachment data");
  const bytes = Buffer.from(input.data, "base64");
  if (bytes.length > 10 * 1024 * 1024)
    throw new Error("Attachments must be at most 10 MB");
  const suffix = extname(input.name).toLowerCase();
  if (!/^\.[a-z0-9]{1,10}$/.test(suffix))
    throw new Error("Attachment must have a supported file extension");
  const path = resolve(
    root,
    `${createHash("sha256").update(bytes).digest("hex")}${suffix}`,
  );
  await mkdir(root, { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  return path;
}
