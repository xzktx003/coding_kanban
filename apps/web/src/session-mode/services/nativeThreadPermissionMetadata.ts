/** Last received field observations only; never a current permission/source lease. */
export type NativePermissionObservation<T> =
  | Readonly<{ kind: "value"; value: T }>
  | Readonly<{ kind: "invalid" }>;

export type NativePermissionProfile = Readonly<{
  id: string;
  extends: string | null;
}>;

export type NativePermissionMetadata = Readonly<{
  activePermissionProfile?: NativePermissionObservation<
    NativePermissionProfile | null
  >;
  runtimeWorkspaceRoots?: NativePermissionObservation<readonly string[]>;
}>;

// Application retention budgets, not limits asserted by the native protocol.
const MAX_PROFILE_STRING_BYTES = 4096;
const MAX_ROOTS = 256;
const MAX_ROOT_STRING_BYTES = 4096;
const MAX_ROOTS_BYTES = 65536;
const encoder = new TextEncoder();
const INVALID = Object.freeze({ kind: "invalid" } as const);
const ACCESSOR = Symbol("unread metadata accessor");
type OwnField = { present: false } | { present: true; value: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ownField(value: object, key: string): OwnField {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return { present: false };
  // Wire JSON has data properties; do not execute a caller's accessor.
  return {
    present: true,
    value: Object.hasOwn(descriptor, "value") ? descriptor.value : ACCESSOR,
  };
}

function stringBytes(value: unknown, maximum: number): number | undefined {
  if (typeof value !== "string" || value.length > maximum) return undefined;
  const bytes = encoder.encode(value).byteLength;
  return bytes <= maximum ? bytes : undefined;
}

function observed<T>(value: T): NativePermissionObservation<T> {
  return Object.freeze({ kind: "value", value });
}

function profileObservation(
  value: unknown,
): NativePermissionObservation<NativePermissionProfile | null> {
  if (value === null) return observed(null);
  if (!isRecord(value)) return INVALID;
  const id = ownField(value, "id");
  const parent = ownField(value, "extends");
  if (
    !id.present ||
    stringBytes(id.value, MAX_PROFILE_STRING_BYTES) === undefined ||
    !parent.present ||
    (parent.value !== null &&
      stringBytes(parent.value, MAX_PROFILE_STRING_BYTES) === undefined)
  )
    return INVALID;
  return observed(
    Object.freeze({
      id: id.value as string,
      extends: parent.value as string | null,
    }),
  );
}

function rootsObservation(
  value: unknown,
): NativePermissionObservation<readonly string[]> {
  if (!Array.isArray(value) || value.length > MAX_ROOTS) return INVALID;
  const roots: string[] = [];
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    const item = ownField(value, String(index));
    if (!item.present) return INVALID;
    const bytes = stringBytes(item.value, MAX_ROOT_STRING_BYTES);
    if (bytes === undefined || total + bytes > MAX_ROOTS_BYTES) return INVALID;
    total += bytes;
    roots.push(item.value as string);
  }
  return observed(Object.freeze(roots));
}

/** Only primary native payload own keys participate; there is no fallback input. */
export function projectNativePermissionMetadata(
  value: unknown,
): NativePermissionMetadata | undefined {
  if (!isRecord(value)) return undefined;
  const profile = ownField(value, "activePermissionProfile");
  const roots = ownField(value, "runtimeWorkspaceRoots");
  const next: {
    activePermissionProfile?: NativePermissionObservation<
      NativePermissionProfile | null
    >;
    runtimeWorkspaceRoots?: NativePermissionObservation<readonly string[]>;
  } = {};
  // An explicit undefined is omission for legacy-compatible in-memory callers.
  if (profile.present && profile.value !== undefined)
    next.activePermissionProfile = profileObservation(profile.value);
  if (roots.present && roots.value !== undefined)
    next.runtimeWorkspaceRoots = rootsObservation(roots.value);
  return Object.keys(next).length ? Object.freeze(next) : undefined;
}

function normalizedObservation<T>(
  metadata: unknown,
  key: string,
  copyValue: (value: unknown) => NativePermissionObservation<T>,
): NativePermissionObservation<T> | undefined {
  if (!isRecord(metadata)) return undefined;
  const field = ownField(metadata, key);
  if (!field.present || field.value === undefined) return undefined;
  if (!isRecord(field.value)) return INVALID;
  const kind = ownField(field.value, "kind");
  if (!kind.present) return INVALID;
  if (kind.value === "invalid") return INVALID;
  if (kind.value !== "value") return INVALID;
  const value = ownField(field.value, "value");
  return value.present ? copyValue(value.value) : INVALID;
}

function sameProfile(
  left: NativePermissionObservation<NativePermissionProfile | null> | undefined,
  right: NativePermissionObservation<NativePermissionProfile | null> | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === "invalid" || right.kind === "invalid") return true;
  return (
    left.value === right.value ||
    (left.value !== null &&
      right.value !== null &&
      left.value.id === right.value.id &&
      left.value.extends === right.value.extends)
  );
}

function sameRoots(
  left: NativePermissionObservation<readonly string[]> | undefined,
  right: NativePermissionObservation<readonly string[]> | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === "invalid" || right.kind === "invalid") return true;
  return (
    left.value.length === right.value.length &&
    left.value.every((root, index) => root === right.value[index])
  );
}

/** Accumulate independent last observations; equal fields retain owned references. */
export function mergeNativePermissionMetadata(
  previous: NativePermissionMetadata | undefined,
  incoming: unknown,
  initialOnly = false,
): NativePermissionMetadata | undefined {
  const offeredProfile = normalizedObservation(
    incoming,
    "activePermissionProfile",
    profileObservation,
  );
  const offeredRoots = normalizedObservation(
    incoming,
    "runtimeWorkspaceRoots",
    rootsObservation,
  );
  const profile =
    offeredProfile === undefined ||
    (initialOnly && previous?.activePermissionProfile !== undefined) ||
    sameProfile(previous?.activePermissionProfile, offeredProfile)
      ? previous?.activePermissionProfile
      : offeredProfile;
  const roots =
    offeredRoots === undefined ||
    (initialOnly && previous?.runtimeWorkspaceRoots !== undefined) ||
    sameRoots(previous?.runtimeWorkspaceRoots, offeredRoots)
      ? previous?.runtimeWorkspaceRoots
      : offeredRoots;
  if (
    profile === previous?.activePermissionProfile &&
    roots === previous?.runtimeWorkspaceRoots
  )
    return previous;
  return Object.freeze({
    ...(profile !== undefined ? { activePermissionProfile: profile } : {}),
    ...(roots !== undefined ? { runtimeWorkspaceRoots: roots } : {}),
  });
}
