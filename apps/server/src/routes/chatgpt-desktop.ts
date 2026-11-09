import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import { readDesktopProjectPersistence } from "@agent-orchestrator/chatgpt-desktop-host/control-client";
import {
  createChatGptDesktopProfileService,
  type ChatGptDesktopProfile,
  type ChatGptDesktopProfileResult,
  type ChatGptDesktopProfileStatus,
} from "../services/chatgpt-desktop-profile.js";

interface ArchiveAsset {
  body: Buffer;
  contentType: string;
  etag: string;
  release(): void;
}
interface WebviewArchive {
  acquireAsset(
    member: string,
    options?: { signal?: AbortSignal },
  ): Promise<ArchiveAsset>;
  close(): Promise<void>;
}
type ArchiveOpener = (options: {
  asarPath: string;
  sha256: string;
}) => Promise<WebviewArchive>;
interface ProfileReader {
  readValidated(): Promise<ChatGptDesktopProfileResult>;
}
interface AdaptedAsset {
  body: Buffer;
  originalSha256: string;
  adaptedSha256: string;
}
export interface ChatGptDesktopRouteOptions {
  /** Server-side construction only, never derived from HTTP parameters. */
  profileService?: ProfileReader;
  archiveOpener?: ArchiveOpener;
  /** Server-owned fixed project persistence metadata reader; never opens a view. */
  projectPersistenceReader?: (options: {
    profile: Readonly<ChatGptDesktopProfile>;
    verifyProfile: () => Promise<boolean>;
  }) => Promise<unknown>;
  /** Versioned host entry adapter. */
  entryAdapter?: (options: {
    body: Uint8Array;
    profileId: string;
    generation: string;
  }) => { body: Buffer; originalSha256: string; adaptedSha256: string };
  /** Explicit, server-owned member list; conversion is never selected by HTTP. */
  assetAdapter?: {
    members: readonly string[];
    adapt(options: { member: string; body: Buffer }): AdaptedAsset | null;
  };
}
interface Entry {
  profile: Readonly<ChatGptDesktopProfile>;
  promise: Promise<WebviewArchive>;
  archive?: WebviewArchive;
}
interface PendingResponse {
  profile: Readonly<ChatGptDesktopProfile>;
  entry: Entry;
  finishLease(): void;
  isClosed(): boolean;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RAW_RESOURCE = new RegExp(
  `^/chatgpt-desktop/(${UUID})/(${UUID})/webview/(.*)$`,
);
// Separate from the archive's 32 MiB original-resource leases. Reserve the
// maximum output before converting, including while a slow response drains.
// Conversions are synchronous, one bounded source at a time, with no body cache.
const MAX_ADAPTER_SOURCE_BYTES = 512 * 1024;
const MAX_ADAPTER_OUTPUT_BYTES = 512 * 1024;
const MAX_ADAPTED_RESPONSE_BYTES = 4 * 1024 * 1024;
const PROJECT_HINT_MEMBER = "webview/assets/create-project-dialog-5d973a8dd7a1.js";
const PROJECT_HINT_BYTES = 64 * 1024;
const FIXED_NINE_ADAPTER_MEMBERS = new Set([
  "webview/assets/app-runtime-b179428fcc1e.js",
  "webview/assets/local-conversation-page-50ae20551907.js",
  "webview/assets/local-conversation-thread-2f594f841b07.js",
  "webview/assets/codex-composer-adapter-d1ca952732ea.js",
  PROJECT_HINT_MEMBER,
  "webview/assets/app-main-efa2926f393b.js",
  "webview/assets/initialize-app-host-services-a3479e215e83.js",
  "webview/assets/use-resume-conversation-if-needed-2ee16336bda8.js",
  "webview/assets/pending-request-item-panel-cef204561ca3.js",
]);
// One exact already-served original composer member needs a narrow adaptation.
// Only the two fixed shared recipes may use its exact source/output bound;
// generic member counts, all other per-member caps and the4MiB total stay fixed.
const SHARED_SUBMIT_MEMBER = "webview/assets/composer-content-b926d24ef280.js";
const SHARED_SUBMIT_SOURCE_BYTES = 541834;
const SHARED_SUBMIT_OUTPUT_BYTES = 550026;
const SHARED_SUBMIT_ORIGINAL_SHA256 = "cf56f37714e14488239f4eb715b845067e75f8c2e98851c768c4110d3eb6fd08";
const FIXED_SUBMIT_NINE_MEMBERS = new Set([...FIXED_NINE_ADAPTER_MEMBERS].filter(x=>x!==PROJECT_HINT_MEMBER).concat(SHARED_SUBMIT_MEMBER));
const FIXED_SUBMIT_TEN_MEMBERS = new Set([...FIXED_NINE_ADAPTER_MEMBERS,SHARED_SUBMIT_MEMBER]);
const SHARED_LOCATION_MEMBER = "webview/assets/location-menu-68c55551634b.js";
const FIXED_CHOICE_TEN_MEMBERS = new Set([...FIXED_SUBMIT_NINE_MEMBERS,SHARED_LOCATION_MEMBER]);
const FIXED_CHOICE_ELEVEN_MEMBERS = new Set([...FIXED_SUBMIT_TEN_MEMBERS,SHARED_LOCATION_MEMBER]);
const SSH_SETTINGS_MEMBER = "webview/assets/remote-connections-settings-4dd0ca54883c.js";
const FIXED_SSH_DISCOVERY_ELEVEN_MEMBERS = new Set([
  ...FIXED_CHOICE_TEN_MEMBERS,
  SSH_SETTINGS_MEMBER,
]);
const hash = (body: Uint8Array) =>
  createHash("sha256").update(body).digest("hex");
const PROFILE_FIELDS = [
  "version",
  "id",
  "generation",
  "pid",
  "startTicks",
  "uid",
  "macAsarPath",
  "macAsarSha256",
  "linuxAsarPath",
  "linuxAsarSha256",
  "controlSocketPath",
  "serverSshSocketPath",
] as const;
const FAILURE_CODES = new Set([
  "invalid_profile_path",
  "unsafe_profile_directory",
  "unsafe_profile_file",
  "profile_changed",
  "invalid_profile",
  "unsafe_asset_path",
  "unsafe_control_directory",
  "unsafe_control_socket",
  "unsafe_server_ssh_directory",
  "unsafe_server_ssh_socket",
  "process_identity_unavailable",
  "profile_unavailable",
]);
const unavailable = (): ChatGptDesktopProfileResult => ({
  status: { state: "unavailable", reasonCode: "profile_unavailable" },
});

function sameProfile(
  a: Readonly<ChatGptDesktopProfile>,
  b: Readonly<ChatGptDesktopProfile>,
): boolean {
  return PROFILE_FIELDS.every((field) => a[field] === b[field]);
}

/** Validate the raw URL ourselves, before using Fastify's decoded parameters. */
function parseResource(
  request: FastifyRequest,
): { id: string; generation: string; member: string } | null {
  const rawPath = (request.raw.url ?? request.url).split("?", 1)[0]!;
  const match = RAW_RESOURCE.exec(rawPath);
  if (!match) return null;
  const rawParts = match[3]!.split("/");
  const parts: string[] = [];
  for (const raw of rawParts) {
    if (!raw) return null;
    let part: string;
    try {
      part = decodeURIComponent(raw);
    } catch {
      return null;
    }
    // Reject slash escapes and a remaining percent, so a downstream decoder
    // can never turn a second decoding pass into traversal or a new separator.
    if (
      !part ||
      part === "." ||
      part === ".." ||
      /[\/%\\\x00-\x1f\x7f]/.test(part)
    )
      return null;
    parts.push(part);
  }
  const member = `webview/${parts.join("/")}`;
  if (member.length > 4096) return null;
  return { id: match[1]!, generation: match[2]!, member };
}

function publicStatus(
  result: ChatGptDesktopProfileResult,
): ChatGptDesktopProfileStatus {
  const status = result.status;
  if (status.state === "unconfigured")
    return { state: "unconfigured", reasonCode: "not_configured" };
  if (status.state === "unavailable") {
    const reasonCode = FAILURE_CODES.has(status.reasonCode)
      ? status.reasonCode
      : "profile_unavailable";
    return { state: "unavailable", reasonCode };
  }
  if (
    !result.profile ||
    status.profileId !== result.profile.id ||
    status.generation !== result.profile.generation ||
    !new RegExp(`^${UUID}$`).test(status.profileId) ||
    !new RegExp(`^${UUID}$`).test(status.generation)
  ) {
    return { state: "unavailable", reasonCode: "profile_unavailable" };
  }
  return {
    state: "ready",
    profileId: status.profileId,
    generation: status.generation,
    reasonCode: "identity_ready",
  };
}

function statusCode(status: ChatGptDesktopProfileStatus): number {
  return status.state === "ready"
    ? 200
    : status.state === "unconfigured"
      ? 404
      : 503;
}
function assetFailure(reply: FastifyReply, code = 503) {
  return reply
    .code(code)
    .type("application/json; charset=utf-8")
    .send({
      error:
        code === 400
          ? "invalid_path"
          : code === 404
            ? "not_found"
            : "profile_unavailable",
    });
}
function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((part) => {
    const candidate = part.trim();
    return candidate === "*" || candidate === etag || candidate === `W/${etag}`;
  });
}

const defaultArchiveOpener: ArchiveOpener = async (options) => {
  const { openWebviewArchive } =
    await import("@agent-orchestrator/chatgpt-desktop-host/assets");
  return openWebviewArchive(options);
};

/** Fixed-profile resources and bounded control-broker metadata only. */
export async function registerChatGptDesktopRoutes(
  app: FastifyInstance,
  options: ChatGptDesktopRouteOptions = {},
) {
  const profileService =
    options.profileService ?? createChatGptDesktopProfileService();
  const openArchive = options.archiveOpener ?? defaultArchiveOpener;
  const entryAdapter = options.entryAdapter;
  const assetAdapter = options.assetAdapter?.adapt;
  const memberList = options.assetAdapter?.members ?? [];
  const adaptedMembers = new Set(memberList);
  const fixedNine = memberList.length === FIXED_NINE_ADAPTER_MEMBERS.size &&
    adaptedMembers.size === FIXED_NINE_ADAPTER_MEMBERS.size &&
    [...adaptedMembers].every(member => FIXED_NINE_ADAPTER_MEMBERS.has(member));
  const exactMembers=(fixed:Set<string>)=>memberList.length===fixed.size&&adaptedMembers.size===fixed.size&&[...adaptedMembers].every(member=>fixed.has(member));
  const fixedSubmit = exactMembers(FIXED_SUBMIT_NINE_MEMBERS)||exactMembers(FIXED_SUBMIT_TEN_MEMBERS)||exactMembers(FIXED_CHOICE_TEN_MEMBERS)||exactMembers(FIXED_CHOICE_ELEVEN_MEMBERS);
  const fixedSshDiscovery = exactMembers(FIXED_SSH_DISCOVERY_ELEVEN_MEMBERS);
  if (
    (memberList.length > 8 && !fixedNine && !fixedSubmit && !fixedSshDiscovery) ||
    (options.assetAdapter && typeof assetAdapter !== "function") ||
    [...adaptedMembers].some(
      (member) =>
        typeof member !== "string" ||
        !/^webview\/assets\/[a-zA-Z0-9_.-]+\.js$/.test(member),
    )
  )
    throw new Error("Invalid desktop asset adapter manifest");
  let adaptedResponseBytes = 0;
  const pendingResponses = new WeakMap<FastifyRequest, PendingResponse>();
  const closings = new Set<Promise<void>>();
  let active: Entry | undefined;
  let shuttingDown = false;
  let archiveCloseFailed = false;
  let persistenceProbe: { profile: Readonly<ChatGptDesktopProfile>; promise: Promise<string> } | undefined;

  function closeArchive(archive: WebviewArchive) {
    const pending = Promise.resolve()
      .then(() => archive.close())
      .catch(() => {
        archiveCloseFailed = true;
        retire();
      });
    closings.add(pending);
    void pending.finally(() => closings.delete(pending));
  }
  function retire() {
    const old = active;
    active = undefined;
    if (old?.archive) closeArchive(old.archive);
    // If open is still in flight its resolution sees active !== old and closes itself.
  }
  function observe(next: Readonly<ChatGptDesktopProfile> | undefined) {
    if (active && (!next || !sameProfile(active.profile, next))) retire();
  }
  async function current(): Promise<ChatGptDesktopProfileResult> {
    try {
      const value = await profileService.readValidated();
      const status = publicStatus(value);
      if (status.state !== "ready") {
        observe(undefined);
        return { status };
      }
      if (!value.profile) {
        observe(undefined);
        return unavailable();
      }
      const snapshot = Object.freeze({ ...value.profile });
      observe(snapshot);
      return { status, profile: snapshot };
    } catch {
      observe(undefined);
      return unavailable();
    }
  }
  function archiveFor(profile: Readonly<ChatGptDesktopProfile>): Entry {
    if (active && sameProfile(active.profile, profile)) return active;
    retire();
    const entry: Entry = {
      profile,
      promise: undefined as unknown as Promise<WebviewArchive>,
    };
    active = entry;
    entry.promise = Promise.resolve()
      .then(async () => {
        // Never start a replacement while an already opened archive is still closing.
        // A stale, not-yet-open promise closes itself when its opener resolves.
        await Promise.allSettled([...closings]);
        if (shuttingDown || archiveCloseFailed || active !== entry)
          throw new Error("archive retired");
        return openArchive({
          asarPath: profile.macAsarPath,
          sha256: profile.macAsarSha256,
        });
      })
      .then(
        async (archive) => {
          if (shuttingDown || active !== entry) {
            try {
              await archive.close();
            } catch {
              archiveCloseFailed = true;
              retire();
            }
            throw new Error("archive retired");
          }
          entry.archive = archive;
          return archive;
        },
        (error: unknown) => {
          if (active === entry) active = undefined;
          throw error;
        },
      );
    return entry;
  }
  app.addHook("onClose", async () => {
    shuttingDown = true;
    retire();
    await Promise.allSettled([...closings]);
  });
  app.addHook("onRequest", async (_request, reply) => {
    reply.header("cache-control", "private, no-store");
    reply.header("x-content-type-options", "nosniff");
  });
  app.addHook("onSend", async (request, reply, payload) => {
    const pending = pendingResponses.get(request);
    if (!pending) return payload;
    pendingResponses.delete(request);
    if (pending.isClosed()) {
      pending.finishLease();
      return payload;
    }
    const latest = await current();
    if (pending.isClosed()) {
      pending.finishLease();
      return payload;
    }
    if (
      latest.status.state !== "ready" ||
      !latest.profile ||
      !sameProfile(pending.profile, latest.profile) ||
      archiveCloseFailed ||
      active !== pending.entry
    ) {
      pending.finishLease();
      reply.removeHeader("etag");
      reply.removeHeader("x-original-content-sha256");
      reply.removeHeader("content-length");
      reply.code(503).type("application/json; charset=utf-8");
      return JSON.stringify({ error: "profile_unavailable" });
    }
    return payload;
  });

  app.get(
    "/api/chatgpt-desktop/status",
    { logLevel: "silent" },
    async (_request, reply) => {
      const result = await current();
      const status = publicStatus(result);
      if (status.state !== "ready" || !result.profile)
        return reply.code(statusCode(status)).send(status);
      const original = result.profile;
      let probe = persistenceProbe;
      if (!probe) {
        const reader = options.projectPersistenceReader ?? readDesktopProjectPersistence;
        const verifyProfile = async () => {
          const latest = await current();
          return latest.status.state === "ready" && !!latest.profile && sameProfile(original, latest.profile);
        };
        const promise = Promise.resolve().then(() => reader({ profile: original, verifyProfile })).then((value) =>
          typeof value === "string" && ["disabled", "waiting", "active", "unsupported", "error"].includes(value) ? value : "unknown",
        ).catch(() => "unknown");
        probe = { profile: original, promise };
        persistenceProbe = probe;
        void promise.finally(() => { if (persistenceProbe === probe) persistenceProbe = undefined; });
      }
      const state = sameProfile(probe.profile, original) ? await probe.promise : "unknown";
      const latest = await current();
      if (latest.status.state !== "ready" || !latest.profile || !sameProfile(original, latest.profile))
        return reply.code(503).send(unavailable().status);
      return reply.code(200).send({ ...status, projectPersistence: { state } });
    },
  );

  app.get(
    "/chatgpt-desktop/:profileId/:generation/webview/*",
    { logLevel: "silent" },
    async (request, reply) => {
      const parsed = parseResource(request);
      if (!parsed) return assetFailure(reply, 400);
      const abort = new AbortController();
      let archiveRelease: (() => void) | undefined;
      let releaseAdapted: (() => void) | undefined;
      let usedEntry: Entry | undefined;
      let ended = false;
      let released = false;
      const finishLease = () => {
        if (!released && archiveRelease) {
          released = true;
          try {
            archiveRelease();
          } catch {}
          archiveRelease = undefined;
        }
        releaseAdapted?.();
        releaseAdapted = undefined;
      };
      const finish = () => {
        if (ended) return;
        ended = true;
        abort.abort();
        finishLease();
        request.raw.off("aborted", finish);
        reply.raw.off("close", finish);
        reply.raw.off("finish", finish);
        reply.raw.off("error", finish);
      };
      request.raw.once("aborted", finish);
      reply.raw.once("close", finish);
      reply.raw.once("finish", finish);
      reply.raw.once("error", finish);
      try {
        const first = await current();
        if (ended) return reply;
        if (first.status.state !== "ready" || !first.profile)
          return assetFailure(reply, statusCode(first.status));
        if (
          first.profile.id !== parsed.id ||
          first.profile.generation !== parsed.generation
        )
          return assetFailure(reply, 404);
        const beforeOpen = await current();
        if (ended) return reply;
        if (
          beforeOpen.status.state !== "ready" ||
          !beforeOpen.profile ||
          !sameProfile(first.profile, beforeOpen.profile)
        )
          return assetFailure(reply);
        const entry = archiveFor(first.profile);
        usedEntry = entry;
        const archive = await entry.promise;
        if (ended) return reply;
        let asset: ArchiveAsset | undefined = await archive.acquireAsset(
          parsed.member,
          {
            signal: abort.signal,
          },
        );
        archiveRelease = asset.release;
        if (ended) {
          finishLease();
          return reply;
        }
        if (
          !Buffer.isBuffer(asset.body) ||
          typeof asset.contentType !== "string" ||
          asset.contentType.length > 128 ||
          /[\x00-\x1f\x7f]/.test(asset.contentType) ||
          typeof asset.etag !== "string" ||
          !/^"[0-9a-f]{64}"$/.test(asset.etag)
        ) {
          finishLease();
          return assetFailure(reply);
        }
        pendingResponses.set(request, {
          profile: first.profile,
          entry,
          finishLease,
          isClosed: () => ended,
        });
        let body = asset.body,
          etag = asset.etag;
        const contentType = asset.contentType;
        // Retain only the release callback, rather than the acquired object and
        // its original Buffer, once a converted response replaces that Buffer.
        asset = undefined;
        const convertEntry =
          parsed.member === "webview/index.html" && entryAdapter;
        const convertAsset = adaptedMembers.has(parsed.member) && assetAdapter;
        if (convertEntry || convertAsset) {
          const fixedComposer = !!convertAsset && fixedSubmit && parsed.member === SHARED_SUBMIT_MEMBER;
          const reserveBytes = fixedComposer ? SHARED_SUBMIT_OUTPUT_BYTES : MAX_ADAPTER_OUTPUT_BYTES;
          if (
            (fixedComposer && (body.length!==SHARED_SUBMIT_SOURCE_BYTES || hash(body)!==SHARED_SUBMIT_ORIGINAL_SHA256)) ||
            body.length > (fixedComposer ? SHARED_SUBMIT_SOURCE_BYTES : convertAsset && parsed.member === PROJECT_HINT_MEMBER ? PROJECT_HINT_BYTES : MAX_ADAPTER_SOURCE_BYTES) ||
            adaptedResponseBytes + reserveBytes > MAX_ADAPTED_RESPONSE_BYTES
          )
            throw new Error("Desktop adapter byte budget exceeded");
          adaptedResponseBytes += reserveBytes;
          releaseAdapted = () => {
            adaptedResponseBytes -= reserveBytes;
          };
          const originalSha256 = hash(body);
          const adapted = convertEntry
            ? convertEntry({
                body,
                profileId: first.profile.id,
                generation: first.profile.generation,
              })
            : (convertAsset as NonNullable<typeof assetAdapter>)({
                member: parsed.member,
                body,
              });
          if (adapted) {
            const outputLimit = convertEntry
              ? 256 * 1024
              : fixedComposer ? SHARED_SUBMIT_OUTPUT_BYTES : parsed.member === PROJECT_HINT_MEMBER ? PROJECT_HINT_BYTES : MAX_ADAPTER_OUTPUT_BYTES;
            if (
              !Buffer.isBuffer(adapted.body) ||
              adapted.body.length > outputLimit ||
              adapted.originalSha256 !== originalSha256 ||
              adapted.adaptedSha256 !== hash(adapted.body)
            )
              throw new Error("Invalid desktop resource adapter");
            body = adapted.body;
            etag = '"' + adapted.adaptedSha256 + '"';
            reply.header("x-original-content-sha256", adapted.originalSha256);
          } else {
            releaseAdapted();
            releaseAdapted = undefined;
          }
        }
        reply.header("etag", etag).type(contentType);
        if (etagMatches(request.headers["if-none-match"], etag))
          return reply.code(304).send();
        return reply.send(body);
      } catch (error) {
        finishLease();
        if (ended) return reply;
        const code = (error as { code?: unknown })?.code;
        if (
          usedEntry &&
          active === usedEntry &&
          (code === "ASAR_IDENTITY_CHANGED" ||
            code === "ASAR_MEMBER_DIGEST_MISMATCH" ||
            code === "ASAR_CLOSED")
        )
          retire();
        return assetFailure(
          reply,
          code === "ASAR_NOT_FOUND" || code === "ASAR_INVALID_PATH" ? 404 : 503,
        );
      }
    },
  );
}
