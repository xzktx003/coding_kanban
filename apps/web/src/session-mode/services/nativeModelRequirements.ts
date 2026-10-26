/** Bounded requirements data, independently matched to a captured runtime instance.
 * This carries no account, thread, cwd, reviewer or model-selection authority.
 */
export type NativeModelRequirementsSource =
  | "native-null"
  | "auto-review-absent"
  | "auto-review-null"
  | "required-models-absent"
  | "required-models-null"
  | "required-models-list";

export interface KnownNativeModelRequirements {
  readonly status: "known";
  readonly runtimeInstance: string;
  readonly autoReviewSource: NativeModelRequirementsSource;
  readonly requiredOnModels: readonly string[] | null;
}

export type NativeModelRequirements = KnownNativeModelRequirements | {
  readonly status: "unavailable";
};

const UNAVAILABLE = Object.freeze({ status: "unavailable" } as const);
const UTF8 = new TextEncoder();

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function own(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function known(
  runtimeInstance: string,
  autoReviewSource: NativeModelRequirementsSource,
  requiredOnModels: readonly string[] | null,
): KnownNativeModelRequirements {
  return Object.freeze({ status: "known", runtimeInstance, autoReviewSource, requiredOnModels });
}

/** Decode only the R28a auto-review projection. Legacy permission fields have
 * their own consumers; neither their nulls nor this result grant permission.
 */
export function decodeNativeModelRequirements(
  dto: unknown,
  expectedRuntimeInstance: unknown,
): NativeModelRequirements {
  if (typeof expectedRuntimeInstance !== "string" || !expectedRuntimeInstance ||
      !record(dto) || !own(dto, "projection") || !record(dto.projection) ||
      !own(dto, "requirements")) return UNAVAILABLE;
  const projection = dto.projection;
  if (["version", "source", "scope", "runtimeInstance", "status", "autoReviewSource"]
    .some((key) => !own(projection, key)) ||
      projection.version !== 1 || projection.source !== "configRequirements/read" ||
      projection.scope !== "runtime-global" || projection.status !== "known" ||
      projection.runtimeInstance !== expectedRuntimeInstance) return UNAVAILABLE;

  const source = projection.autoReviewSource;
  const requirements = dto.requirements;
  if (source === "native-null") {
    return requirements === null ? known(expectedRuntimeInstance, source, null) : UNAVAILABLE;
  }
  if (!record(requirements) || !own(requirements, "autoReview")) return UNAVAILABLE;
  const autoReview = requirements.autoReview;
  if (source === "auto-review-absent" || source === "auto-review-null") {
    return autoReview === null ? known(expectedRuntimeInstance, source, null) : UNAVAILABLE;
  }
  if (!record(autoReview) || !own(autoReview, "requiredOnModels")) return UNAVAILABLE;
  const models = autoReview.requiredOnModels;
  if (source === "required-models-absent" || source === "required-models-null") {
    return models === null ? known(expectedRuntimeInstance, source, null) : UNAVAILABLE;
  }
  if (source !== "required-models-list" || !Array.isArray(models) || models.length > 256) {
    return UNAVAILABLE;
  }
  let bytes = 0;
  for (const model of models) {
    if (typeof model !== "string" || !model || model.length > 512 ||
        /[\x00-\x1f\x7f]/.test(model)) return UNAVAILABLE;
    const length = UTF8.encode(model).byteLength;
    if (length > 512 || (bytes += length) > 65536) return UNAVAILABLE;
  }
  return known(expectedRuntimeInstance, source, Object.freeze([...models]));
}

/** Original F_t/G_t data query. Unknown data must be handled by the caller;
 * false from a known empty requirement is not an approval or eligibility grant.
 */
export function isAutoReviewRequiredForModel(
  requirements: KnownNativeModelRequirements,
  target: string | null | undefined,
): boolean {
  if (requirements?.status !== "known") throw new TypeError("Known model requirements are required");
  if (target != null && typeof target !== "string") throw new TypeError("Model target must be a string or nullish");
  if (target == null || requirements.requiredOnModels === null) return false;
  const slash = target.indexOf("/");
  if (slash === -1) return requirements.requiredOnModels.includes(target);
  const prefix = target.slice(0, slash);
  const model = target.slice(slash + 1);
  if (!prefix || model.includes("/") || !/^[A-Za-z0-9_-]+$/.test(prefix)) return false;
  return requirements.requiredOnModels.includes(model);
}
