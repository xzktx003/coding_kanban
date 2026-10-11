import {
  mkdir,
  stat,
  open,
  rm,
  rename,
  mkdtemp,
  writeFile,
  readFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { HttpError, type JsonObject } from "../core/json.js";
import { Serial, run } from "./common.js";
import {
  readCodexAuth,
  transcribeWithCodex,
  type CodexSocket,
} from "./codex-dictation.js";
export class Dictation {
  private downloads = new Map<
    string,
    { controller: AbortController; done: Promise<void> }
  >();
  private errors = new Map<string, string>();
  private operations = new Serial();
  private inference = new Serial();
  constructor(
    private dataHome: string,
    private env: NodeJS.ProcessEnv,
    private fetcher: typeof fetch = fetch,
    private socketFactory?: CodexSocket,
  ) {}
  private model(input: JsonObject) {
    const id = input.modelId ?? input.model ?? "base";
    if (
      typeof id !== "string" ||
      !["tiny", "base", "small", "medium", "large-v3"].includes(id)
    )
      throw new HttpError(400, "Unsupported dictation model");
    return id;
  }
  private path(id: string) {
    return join(this.dataHome, "dictation", `ggml-${id}.bin`);
  }
  private partial(id: string) {
    return join(this.dataHome, "dictation", `ggml-${id}.part`);
  }
  async status(input: JsonObject) {
    const modelId = this.model(input);
    const path = this.path(modelId);
    const downloading = this.downloads.has(modelId);
    const ready = await stat(path)
      .then((s) => s.isFile())
      .catch(() => false);
    const error = this.errors.get(modelId) ?? null;
    return {
      state: downloading
        ? "downloading"
        : ready
          ? "ready"
          : error
            ? "error"
            : "missing",
      modelId,
      path,
      error,
      progress: downloading
        ? {
            downloadedBytes: await stat(this.partial(modelId))
              .then((s) => s.size)
              .catch(() => 0),
            totalBytes: null,
          }
        : null,
    };
  }
  download(input: JsonObject) {
    return this.operations.run(async () => {
      const id = this.model(input);
      if (
        await stat(this.path(id))
          .then((s) => s.isFile())
          .catch(() => false)
      )
        return this.status(input);
      if (!this.downloads.has(id)) {
        this.errors.delete(id);
        const controller = new AbortController();
        const done = Promise.resolve()
          .then(() => this.fetchModel(id, controller.signal))
          .catch(async (error) => {
            if (!controller.signal.aborted)
              this.errors.set(id, (error as Error).message);
            await rm(this.partial(id), { force: true });
          })
          .finally(() => {
            this.downloads.delete(id);
          });
        this.downloads.set(id, { controller, done });
      }
      return this.status(input);
    });
  }
  private async fetchModel(id: string, signal: AbortSignal) {
    await mkdir(join(this.dataHome, "dictation"), {
      recursive: true,
      mode: 0o700,
    });
    const response = await this.fetcher(
      `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${id}.bin`,
      { signal },
    );
    if (!response.ok || !response.body)
      throw new Error(`Model download failed (${response.status})`);
    const file = await open(this.partial(id), "w", 0o600);
    let bytes = 0;
    try {
      for await (const chunk of Readable.fromWeb(response.body as never)) {
        signal.throwIfAborted();
        bytes += chunk.length;
        if (bytes > 4 * 1024 ** 3)
          throw new Error("Model download exceeds size limit");
        await file.write(chunk);
      }
      if (bytes < 1024 ** 2) throw new Error("Model download is incomplete");
      await file.sync();
    } finally {
      await file.close();
    }
    signal.throwIfAborted();
    await rename(this.partial(id), this.path(id));
  }
  cancel(input: JsonObject) {
    return this.operations.run(async () => {
      const id = this.model(input);
      const task = this.downloads.get(id);
      if (task) {
        task.controller.abort();
        await task.done;
      }
      await rm(this.partial(id), { force: true });
      return this.status(input);
    });
  }
  remove(input: JsonObject) {
    return this.operations.run(async () => {
      const id = this.model(input);
      if (this.downloads.has(id))
        throw new HttpError(
          400,
          "Cancel the download before removing the model",
        );
      await rm(this.path(id), { force: true });
      return this.status(input);
    });
  }
  async transcribe(input: JsonObject) {
    const id = this.model(input);
    if (
      typeof input.data !== "string" ||
      input.data.length > 5120000 ||
      input.data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(input.data)
    )
      throw new HttpError(400, "Invalid PCM audio");
    const pcm = Buffer.from(input.data, "base64");
    if (pcm.toString("base64") !== input.data)
      throw new HttpError(400, "Invalid PCM audio");
    if (pcm.length < 6400 || pcm.length > 3840000 || pcm.length % 2)
      throw new HttpError(
        400,
        "Audio must be between 0.2 and 120 seconds at 16 kHz mono",
      );
    const language = input.language ?? "auto";
    if (typeof language !== "string" || !/^[a-zA-Z-]{2,16}$/.test(language))
      throw new HttpError(400, "Invalid dictation language");
    return this.inference.run(async () => {
      const auth = await readCodexAuth(this.env).catch(() => null);
      if (auth) {
        try {
          return await transcribeWithCodex(
            pcm,
            auth,
            this.env,
            this.socketFactory,
          );
        } catch (error) {
          console.warn(
            `Codex dictation unavailable, using local Whisper: ${(error as Error).message}`,
          );
        }
      }
      if (
        !(await stat(this.path(id))
          .then((s) => s.isFile())
          .catch(() => false))
      )
        throw new HttpError(400, "Download the selected dictation model first");
      const dir = await mkdtemp(join(tmpdir(), "kanban-dictation-"));
      try {
        const wav = Buffer.alloc(44);
        wav.write("RIFF", 0);
        wav.writeUInt32LE(pcm.length + 36, 4);
        wav.write("WAVEfmt ", 8);
        wav.writeUInt32LE(16, 16);
        wav.writeUInt16LE(1, 20);
        wav.writeUInt16LE(1, 22);
        wav.writeUInt32LE(16000, 24);
        wav.writeUInt32LE(32000, 28);
        wav.writeUInt16LE(2, 32);
        wav.writeUInt16LE(16, 34);
        wav.write("data", 36);
        wav.writeUInt32LE(pcm.length, 40);
        const audio = join(dir, "audio.wav"),
          output = join(dir, "result");
        await writeFile(audio, Buffer.concat([wav, pcm]), { mode: 0o600 });
        try {
          await run(
            this.env.SESSION_WHISPER_BIN ?? "whisper-cli",
            [
              "-m",
              this.path(id),
              "-f",
              audio,
              "-l",
              language,
              "-t",
              "4",
              "-nt",
              "-bs",
              "1",
              "-bo",
              "1",
              "-oj",
              "-of",
              output,
            ],
            { env: this.env, timeout: 600000, maxBytes: 1024 * 1024 },
          );
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT")
            throw new HttpError(
              400,
              "Whisper CLI not found. Install whisper.cpp and set SESSION_WHISPER_BIN.",
            );
          throw new HttpError(400, (error as Error).message);
        }
        const result = JSON.parse(await readFile(output + ".json", "utf8"));
        if (
          !Array.isArray(result.transcription) ||
          result.transcription.some(
            (segment: unknown) =>
              !segment ||
              typeof (segment as { text?: unknown }).text !== "string",
          )
        )
          throw new HttpError(400, "Malformed Whisper transcription");
        return {
          text: result.transcription
            .map((segment: { text: string }) => segment.text)
            .join("")
            .trim(),
        };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
  async close() {
    for (const job of this.downloads.values()) job.controller.abort();
    await Promise.all([...this.downloads.values()].map((job) => job.done));
  }
}
