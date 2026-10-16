import type { FastifyInstance } from "fastify";
import {
  validNativeInputMention,
  type NativeInputMention,
} from "@agent-orchestrator/shared";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rm, writeFile } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve,
} from "node:path";
import { homedir } from "node:os";

const OBJECTIVE_PREFIX = "Read the Codex goal objective file at ";
const OBJECTIVE_SUFFIX = " before continuing.";
const OBJECTIVE_FILE = "goal-objective.md";
const MANIFEST_FILE = ".goal-attachment.json";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{64}$/;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "bmp",
  "tif",
  "tiff",
  "avif",
  "ico",
  "svg",
]);
type Snapshot = {
  objective: string;
  images: string[];
  mentions: NativeInputMention[];
  pastedTexts: string[];
};
type Cleanup = { id: string; token: string };

class GoalAttachmentError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}
function fail(message: string, statusCode = 400): never {
  throw new GoalAttachmentError(message, statusCode);
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const append = (objective: string, title: string, lines: string[]) =>
  lines.length
    ? `${objective ? `${objective}\n\n` : ""}${title}\n${lines.join("\n")}`
    : objective;

function validateSnapshot(value: unknown): Snapshot {
  if (!object(value) || typeof value.objective !== "string")
    fail("Invalid Goal objective");
  if (Buffer.byteLength(value.objective) > MAX_TEXT_BYTES)
    fail("Goal objective exceeds 2 MB", 413);
  const images = value.images ?? [];
  const pastedTexts = value.pastedTexts ?? [];
  const mentions = value.mentions ?? [];
  if (
    !Array.isArray(images) ||
    images.length > 32 ||
    images.some(
      (image) =>
        typeof image !== "string" || !image || /[\x00-\x1f]/.test(image),
    )
  )
    fail("Invalid or excessive Goal images");
  if (
    !Array.isArray(pastedTexts) ||
    pastedTexts.length > 32 ||
    pastedTexts.some((text) => typeof text !== "string")
  )
    fail("Invalid or excessive pasted text attachments");
  if (pastedTexts.some((text) => Buffer.byteLength(text) > MAX_TEXT_BYTES))
    fail("Pasted text exceeds 2 MB", 413);
  if (
    !Array.isArray(mentions) ||
    mentions.length > 100 ||
    mentions.some((mention) => !validNativeInputMention(mention))
  )
    fail("Invalid Goal mention identity");
  if (
    !value.objective.trim() &&
    !images.length &&
    !pastedTexts.length &&
    !mentions.length
  )
    fail("Goal objective must not be empty");
  return { objective: value.objective.trim(), images, pastedTexts, mentions };
}

/** O_NOFOLLOW and bounded reads also apply to our marker and objective files. */
async function readBoundedFile(path: string, maximum: number): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile()) fail("Goal attachment must be a regular file");
    if (info.size > maximum)
      fail("Goal attachment exceeds its size limit", 413);
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(
        Math.min(64 * 1024, maximum - total + 1),
      );
      const { bytesRead } = await handle.read(chunk);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > maximum) fail("Goal attachment exceeds its size limit", 413);
      chunks.push(chunk.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks, total);
  } finally {
    await handle.close();
  }
}

async function verifyDirectory(path: string) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    fail("Invalid Goal attachment directory");
}

async function readMarker(
  directory: string,
): Promise<{ cleanupDigest: string }> {
  await verifyDirectory(directory);
  const bytes = await readBoundedFile(join(directory, MANIFEST_FILE), 1024);
  let marker: unknown;
  try {
    marker = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("Invalid Goal attachment ownership");
  }
  if (
    !object(marker) ||
    marker.version !== 1 ||
    typeof marker.cleanupDigest !== "string" ||
    !TOKEN.test(marker.cleanupDigest)
  )
    fail("Invalid Goal attachment ownership");
  return { cleanupDigest: marker.cleanupDigest };
}

function parseDataImage(source: string): { bytes: Buffer; extension: string } {
  if (source.length > 14 * 1024 * 1024) fail("Goal image exceeds 10 MB", 413);
  const parsed = /^data:image\/([a-z0-9.+-]+)(;base64)?,(.*)$/is.exec(source);
  if (!parsed) fail("Unable to decode Goal image");
  const subtype = parsed[1].toLowerCase();
  const extension =
    subtype === "jpeg" ? "jpg" : subtype === "svg+xml" ? "svg" : subtype;
  if (!IMAGE_EXTENSIONS.has(extension)) fail("Unsupported Goal image format");
  let bytes: Buffer;
  if (parsed[2]) {
    const contents = parsed[3];
    // A repeated group of four exhausts V8's regex stack for a valid 10 MB
    // image. Flat character validation plus length/padding remains bounded.
    if (contents.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(contents))
      fail("Unable to decode Goal image");
    bytes = Buffer.from(contents, "base64");
  } else {
    try {
      bytes = Buffer.from(decodeURIComponent(parsed[3]), "utf8");
    } catch {
      fail("Unable to decode Goal image");
    }
  }
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
    fail("Goal image must be between 1 byte and 10 MB", 413);
  return { bytes, extension };
}

async function readUploadedImage(
  source: string,
  attachmentRoot: string,
): Promise<{ bytes: Buffer; extension: string }> {
  const extension = extname(source).slice(1).toLowerCase();
  const filename = basename(source);
  // Only content-addressed files from the current application upload service
  // are eligible. A path under another project or data home grants no access.
  if (
    dirname(source) !== attachmentRoot ||
    source !== join(attachmentRoot, filename) ||
    !/^[0-9a-f]{64}\.[a-z0-9]{1,8}$/.test(filename) ||
    !IMAGE_EXTENSIONS.has(extension)
  )
    fail("Goal images must be verified session uploads");
  await verifyDirectory(attachmentRoot);
  let bytes: Buffer;
  try {
    bytes = await readBoundedFile(source, MAX_IMAGE_BYTES);
  } catch (error) {
    if (error instanceof GoalAttachmentError) throw error;
    fail("Goal upload is unavailable");
  }
  if (
    !bytes.length ||
    createHash("sha256").update(bytes).digest("hex") !== filename.slice(0, 64)
  )
    fail("Goal upload identity does not match its contents");
  return { bytes, extension };
}

/** These APIs materialize private attachments and read canonical Goal files;
 * they never submit a native operation or read native account/configuration files.
 */
export function registerSessionGoalAttachmentRoutes(
  app: FastifyInstance,
  options: { attachmentRoot?: string; codexHome?: string },
) {
  const uploadRoot = options.attachmentRoot
    ? resolve(options.attachmentRoot)
    : null;
  const goalRoot = uploadRoot
    ? resolve(uploadRoot, "..", "goal-attachments")
    : null;
  // Capture server-owned configuration once. The HTTP body can never select a
  // Codex home, and a relative/invalid configuration grants no native reads.
  const configuredCodexHome =
    options.codexHome ??
    process.env.CODEX_HOME ??
    join(process.env.HOME ?? process.env.USERPROFILE ?? homedir(), ".codex");
  const nativeCodexHome =
    isAbsolute(configuredCodexHome) && !/[\x00-\x1f]/.test(configuredCodexHome)
      ? resolve(configuredCodexHome)
      : null;
  if (goalRoot && /[\x00-\x1f]/.test(goalRoot))
    throw new Error("Invalid Goal attachment storage root");
  const requireRoot = () =>
    goalRoot ?? fail("Goal attachment storage is unavailable", 503);
  const route = (url: string, handler: (body: unknown) => Promise<unknown>) => {
    app.post(url, { bodyLimit: 60 * 1024 * 1024 }, async (request, reply) => {
      try {
        return await handler(request.body);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const statusCode =
          error instanceof GoalAttachmentError
            ? error.statusCode
            : code === "ENOENT"
              ? 404
              : code === "ELOOP"
                ? 400
                : 500;
        const message =
          error instanceof GoalAttachmentError
            ? error.message
            : statusCode === 404
              ? "Goal attachment is unavailable"
              : statusCode === 400
                ? "Invalid Goal attachment path"
                : "Goal attachment operation failed";
        return reply
          .code(statusCode)
          .send({ error: message, deliveryStage: "not-admitted" });
      }
    });
  };

  route("/api/session/goal-attachments/materialize", async (body) => {
    const draft = validateSnapshot(body);
    const root = requireRoot();
    let directory: string | undefined;
    let cleanup: Cleanup | undefined;
    let bytesWritten = 0;
    const ensureDirectory = async () => {
      if (directory) return directory;
      await mkdir(root, { recursive: true, mode: 0o700 });
      await verifyDirectory(root);
      cleanup = { id: randomUUID(), token: randomBytes(32).toString("hex") };
      const candidate = join(root, cleanup.id);
      await mkdir(candidate, { mode: 0o700 });
      directory = candidate;
      await writeFile(
        join(directory, MANIFEST_FILE),
        JSON.stringify({
          version: 1,
          cleanupDigest: createHash("sha256")
            .update(cleanup.token)
            .digest("hex"),
        }),
        { flag: "wx", mode: 0o600 },
      );
      return directory;
    };
    const write = async (filename: string, bytes: Buffer) => {
      bytesWritten += bytes.length;
      if (bytesWritten > MAX_TOTAL_BYTES)
        fail("Goal attachments exceed 40 MB", 413);
      const path = join(await ensureDirectory(), filename);
      await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
      return path;
    };
    try {
      let objective = draft.objective;
      const pasted: string[] = [];
      for (const [index, contents] of draft.pastedTexts.entries()) {
        const path = await write(
          `pasted-text-${index + 1}.txt`,
          Buffer.from(contents, "utf8"),
        );
        pasted.push(
          `- pasted text file: ${path}. Read this file before continuing.`,
        );
      }
      objective = append(objective, "Referenced pasted text files:", pasted);
      const files: string[] = [];
      const urls: string[] = [];
      for (const [index, source] of draft.images.entries()) {
        const position = index + 1;
        if (/^https?:\/\//i.test(source)) {
          if (source.length > 8192) fail("Goal image URL is too long");
          try {
            const url = new URL(source);
            if (!["http:", "https:"].includes(url.protocol))
              fail("Invalid Goal image URL");
          } catch {
            fail("Invalid Goal image URL");
          }
          urls.push(`- [Image #${position}]: ${source}`);
          continue;
        }
        const image = source.startsWith("data:")
          ? parseDataImage(source)
          : await readUploadedImage(source, uploadRoot!);
        const path = await write(
          `image-${position}.${image.extension}`,
          image.bytes,
        );
        files.push(`- [Image #${position}]: ${path}`);
      }
      objective = append(objective, "Referenced image files:", files);
      objective = append(objective, "Referenced image URLs:", urls);
      // GoalSet has one textual objective rather than typed UserInput entries.
      // Retain the captured native mention URI explicitly instead of losing it.
      objective = append(
        objective,
        "Referenced mentions:",
        draft.mentions.map((mention) => `- ${mention.name}: ${mention.path}`),
      );
      if (Array.from(objective).length > 4000) {
        const path = join(await ensureDirectory(), OBJECTIVE_FILE);
        const wrapper = `${OBJECTIVE_PREFIX}${path}${OBJECTIVE_SUFFIX}`;
        if (Array.from(wrapper).length > 4000)
          fail("Goal objective file reference exceeds 4000 characters");
        await write(OBJECTIVE_FILE, Buffer.from(objective, "utf8"));
        objective = wrapper;
      }
      return { objective, ...(cleanup ? { cleanup } : {}) };
    } catch (error) {
      if (directory) {
        try {
          await rm(directory, { recursive: true, force: true });
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Goal materialization and rollback both failed",
          );
        }
      }
      throw error;
    }
  });

  route("/api/session/goal-attachments/read", async (body) => {
    if (
      !object(body) ||
      typeof body.objective !== "string" ||
      Buffer.byteLength(body.objective) > MAX_TEXT_BYTES
    )
      fail("Invalid Goal objective reference");
    const objective = body.objective;
    if (
      !objective.startsWith(OBJECTIVE_PREFIX) ||
      !objective.endsWith(OBJECTIVE_SUFFIX)
    )
      return { objective };
    const path = objective.slice(
      OBJECTIVE_PREFIX.length,
      -OBJECTIVE_SUFFIX.length,
    );
    const id = basename(dirname(path));
    // K0t admits precisely CODEX_HOME/attachments/<n2t UUID>/goal-objective.md.
    // Our own namespace additionally requires its creation marker; native
    // files are read-only and never gain a cleanup capability here.
    if (!UUID.test(id)) return { objective };
    if (goalRoot && path === join(goalRoot, id, OBJECTIVE_FILE)) {
      await verifyDirectory(goalRoot);
      await readMarker(join(goalRoot, id));
    } else if (
      nativeCodexHome &&
      path === join(nativeCodexHome, "attachments", id, OBJECTIVE_FILE)
    ) {
      await verifyDirectory(nativeCodexHome);
      await verifyDirectory(join(nativeCodexHome, "attachments"));
      await verifyDirectory(dirname(path));
      // Equality also rejects symlinks in ancestors above CODEX_HOME; the
      // final bounded open independently uses O_NOFOLLOW for the file itself.
      if (
        (await realpath(nativeCodexHome)) !== nativeCodexHome ||
        (await realpath(path)) !== path
      )
        fail("Invalid native Goal attachment path");
    } else {
      return { objective };
    }
    return {
      objective: (await readBoundedFile(path, MAX_TOTAL_BYTES)).toString(
        "utf8",
      ),
    };
  });

  route("/api/session/goal-attachments/cleanup", async (body) => {
    const root = requireRoot();
    if (
      !object(body) ||
      typeof body.id !== "string" ||
      !UUID.test(body.id) ||
      typeof body.token !== "string" ||
      !TOKEN.test(body.token) ||
      Object.keys(body).some((key) => key !== "id" && key !== "token")
    )
      fail("Invalid Goal attachment cleanup capability");
    const directory = join(root, body.id);
    let marker: { cleanupDigest: string };
    try {
      await verifyDirectory(root);
      marker = await readMarker(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { ok: true };
      throw error;
    }
    const digest = createHash("sha256").update(body.token).digest();
    if (!timingSafeEqual(digest, Buffer.from(marker.cleanupDigest, "hex")))
      fail("Invalid Goal attachment cleanup capability");
    await rm(directory, { recursive: true, force: true });
    return { ok: true };
  });
}
