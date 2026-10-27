import { hash as sha256 } from "fast-sha256";
import { MutationNotStartedError } from "./MutationNotStartedError";
import { isCurrentSessionEditId } from "./sessionEditIdentity";

export interface CapturedSubmissionEdit {
  revision: number;
  writeId?: string;
  /** Captured UUIDs, not paths/content: re-adding a file is a new edit. */
  attachmentIds?: string[];
  contextIds?: string[];
}
export type SubmissionEdit = number | CapturedSubmissionEdit;
const LEGACY = "kanban.session.followup-submissions";
const CURRENT = "kanban.session.submission.v3.";
const VERSION_TWO = "kanban.session.submission.v2.";
const PINNED = "kanban.session.submission.legacy.";
const ambiguous = () =>
  new MutationNotStartedError(
    "旧版本消息提交身份无法核实，草稿已保留，尚未再次发送。请先检查会话和队列中的原消息；确认需要新消息后，编辑正文或重新添加附件/引用再发送。",
  );
const invalidStorage = () =>
  new MutationNotStartedError(
    "无法读取或保存消息提交记录，草稿已保留，尚未发送。请检查浏览器存储后重试。",
  );
function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[-a-zA-Z0-9_:]{1,160}$/.test(value) &&
    !["__proto__", "constructor", "prototype"].includes(value)
  );
}
async function digest(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = globalThis.crypto?.subtle
    ? await globalThis.crypto.subtle.digest("SHA-256", bytes)
    : sha256(bytes);
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
/** JSON semantics are unchanged; only object keys are ordered. Array order is meaningful. */
export function canonicalSubmissionData<T>(value: T): T {
  function sort(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === "object")
      return Object.fromEntries(
        Object.keys(input)
          .sort()
          .map((key) => [key, sort((input as Record<string, unknown>)[key])]),
      );
    return input;
  }
  return sort(JSON.parse(JSON.stringify(value))) as T;
}
function legacyId(key: string): string | undefined {
  const raw = localStorage.getItem(LEGACY);
  if (!raw) return;
  const record: unknown = JSON.parse(raw);
  if (!record || typeof record !== "object" || Array.isArray(record))
    throw invalidStorage();
  if (!Object.hasOwn(record, key)) return;
  const value = (record as Record<string, unknown>)[key];
  if (!validId(value)) throw invalidStorage();
  return value;
}
function legacyPins(hash: string): string[] {
  const ids = new Set<string>(),
    prefix = PINNED + hash;
  for (const key of Object.keys(localStorage)) {
    if (key !== prefix && !key.startsWith(prefix + ".")) continue;
    const value = localStorage.getItem(key);
    if (value === null) continue;
    if (!validId(value)) throw invalidStorage();
    ids.add(value);
  }
  if (ids.size > 1) throw ambiguous();
  return [...ids];
}
function boundMarkers(activeKey: string) {
  // Markers are not the source of new IDs, so concurrent eviction cannot turn a
  // retry into a new request. Legacy UUID pins are never evicted or overwritten.
  const keys = Object.keys(localStorage).filter(
    (key) => key.startsWith(CURRENT) && key !== activeKey,
  );
  for (const key of keys.sort().slice(0, Math.max(0, keys.length - 999)))
    localStorage.removeItem(key);
}

/** No read/random/write race: the same captured edit always derives the same new ID. */
export async function stableSubmissionId(
  owner: string,
  captured: SubmissionEdit,
  data: unknown,
): Promise<string> {
  const edit = typeof captured === "number" ? { revision: captured } : captured;
  const identity = {
    ...(edit.writeId ? { writeId: edit.writeId } : {}),
    ...(edit.attachmentIds?.length
      ? { attachmentIds: [...edit.attachmentIds] }
      : {}),
    ...(edit.contextIds?.length ? { contextIds: [...edit.contextIds] } : {}),
  };
  const oldHash = await digest({ owner, revision: edit.revision, data });
  const versionTwoHash = Object.keys(identity).length
    ? await digest({
        version: 2,
        owner,
        revision: edit.revision,
        identity,
        data,
      })
    : undefined;
  const hash = versionTwoHash
    ? await digest(
        canonicalSubmissionData({
          version: 3,
          owner,
          revision: edit.revision,
          identity,
          data,
        }),
      )
    : undefined;
  try {
    if (hash) {
      // Never silently replace an ID already produced by the former algorithm.
      // Its marker cannot identify a reordered payload; unknown v2 variants fail
      // closed until the user creates an explicit v3 edit.
      const previousId = localStorage.getItem(VERSION_TWO + versionTwoHash);
      if (previousId !== null) {
        if (previousId !== `draft_${versionTwoHash}`) throw invalidStorage();
        return previousId;
      }
      const key = CURRENT + hash;
      const id = `draft3_${hash}`;
      const known = localStorage.getItem(key);
      if (known !== null) {
        if (known !== id) throw invalidStorage();
        return id;
      }
      // Ordinary old UUIDs are not evidence of new intent, even when the old
      // shared map lost its retry record. Versioned creation IDs need no scan.
      if (
        ![
          edit.writeId,
          ...(edit.attachmentIds ?? []),
          ...(edit.contextIds ?? []),
        ].some(isCurrentSessionEditId)
      )
        throw ambiguous();
      localStorage.setItem(key, id);
      boundMarkers(key);
      return id;
    }
    const pinned = legacyPins(oldHash)[0];
    const old = legacyId(oldHash);
    if (pinned !== undefined) {
      if (old && old !== pinned) throw ambiguous();
      return pinned;
    }
    // Missing legacy records may be the result of the old cross-page overwrite.
    // Never fabricate a fresh UUID for an acknowledgement that may have been lost.
    if (!old) throw ambiguous();
    // Immutable aliases expose conflicting old-tab rewrites; no last writer can
    // silently replace an already admitted legacy request's random UUID.
    localStorage.setItem(PINNED + oldHash + "." + old, old);
    if (legacyPins(oldHash)[0] !== old) throw ambiguous();
    return old;
  } catch (error) {
    if (error instanceof MutationNotStartedError) throw error;
    throw invalidStorage();
  }
}
