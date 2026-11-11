import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildFallbackImageMessage, CODEX_IMAGE_FALLBACK_TTL_MS } from "./codex-image-message-service.js";

/** Keep the file for the CLI's asynchronous image read, including unknown input receipts. */
export async function sendCodexTerminalImage(
  image: Buffer,
  extension: string,
  message: string,
  submit: (prompt: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "coding-kanban-codex-image-"));
  const path = join(directory, `image.${extension}`);
  try {
    await writeFile(path, image, { mode: 0o600 });
    await submit(
      buildFallbackImageMessage(message, path),
    );
  } finally {
    const timer = setTimeout(
      () =>
        void rm(directory, { recursive: true, force: true }).catch(() => {}),
      CODEX_IMAGE_FALLBACK_TTL_MS,
    );
    timer.unref();
  }
}
