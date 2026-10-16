import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Versioned original fixture metadata. No runtime dependency on audit output. */
const nativeAssetsDirectory =
  "third_party/openai.chatgpt-26.51007.21434-linux-x64/extension/webview/assets";

export const nativeGoalModules = {
  main: "app-initial-fee819fe4f22.js",
  native: "app-initial-41ab338a184f.js",
  core: "app-initial-c4ebaa710049.js",
} as const;

export const nativeGoalAssetManifest = [
  {
    file: nativeGoalModules.main,
    bytes: 6116260,
    sha256: "460201045b5f5a4255fda737c9baa4768367a973d735cb37f3467bfe6af95316",
  },
  {
    file: nativeGoalModules.native,
    bytes: 5873840,
    sha256: "c755dbca916c0f830a554fe2e3057f8642b32394bea7701338e5d506f692ad56",
  },
  {
    file: nativeGoalModules.core,
    bytes: 7600734,
    sha256: "50e2af3d8c3d0e3c52612beb2d95940cc818dfe979d6d85a9fa61af5526640bc",
  },
  {
    file: "app-initial-49150e6a0951.css",
    bytes: 450,
    sha256: "866b9b68c266c3c1ed8c1c9e11bfb73addc51d760b5f13f8d6c02626d08d8253",
  },
  {
    file: "app-initial-f5b2ced5ef25.css",
    bytes: 205973,
    sha256: "a87bda9db016112d1be80de0a103dc33ac770ba5b7f59a2e74ed9259fb2baff4",
  },
  {
    file: "app-initial-1805ad19110d.css",
    bytes: 72893,
    sha256: "0e29f777615778fae1c7854934f3b8865c88b46e86211641a104f2629dc77f8f",
  },
  {
    file: "app-initial-aad627bd9dff.css",
    bytes: 1283394,
    sha256: "1ca9c6374ba5102c63a45ba2a7a6a9656d1e016c59364133a6e21e5e21ead3e4",
  },
].map((asset) => ({
  ...asset,
  path: `${nativeAssetsDirectory}/${asset.file}`,
}));

// UTF-16 String.slice offsets, verified against the full original module SHA.
// These are exact AST spans, rather than a reformatted/copied implementation.
export const nativeGoalFunctionIndex = {
  Cu: {
    local: "oFi",
    file: nativeGoalModules.native,
    start: 5212699,
    end: 5221416,
    sha256: "036f84b0260d6011b714a42565935dd8cc916fbf79b57efdf4ec3ed07906243e",
  },
  qu: {
    local: "gPi",
    file: nativeGoalModules.native,
    start: 5197002,
    end: 5199178,
    sha256: "d3e6e5a30a04ea2469f7dedb145ec82f56788f271750df9bcea978ad5e1e10be",
  },
} as const;

export const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

export function loadNativeGoalSources() {
  let native = "";
  for (const asset of nativeGoalAssetManifest) {
    const body = readFileSync(resolve(process.cwd(), asset.path));
    if (body.length !== asset.bytes || sha256(body) !== asset.sha256)
      throw new Error(
        `Original Goal asset differs from the pinned fixture: ${asset.path}`,
      );
    if (asset.file === nativeGoalModules.native) native = body.toString("utf8");
  }
  const sources = {} as Record<keyof typeof nativeGoalFunctionIndex, string>;
  for (const key of ["Cu", "qu"] as const) {
    const span = nativeGoalFunctionIndex[key];
    const body = native.slice(span.start, span.end);
    if (
      sha256(body) !== span.sha256 ||
      !body.startsWith(`function ${span.local}(`)
    )
      throw new Error(`Original ${key} function span/hash does not match`);
    sources[key] = body;
  }
  return sources;
}

// These are synthetic fixture reads/subscriptions and view-state bookkeeping.
// No task/config/file write is admitted. The one GoalSet is intercepted by the
// last matching held route and never reaches the underlying fixture's success.
export const productFixturePostPaths = new Set([
  "/api/session/tabs",
  "/api/session/projects",
  "/api/session/api/codex/account/get",
  "/api/session/api/codex/config/read",
  "/api/session/api/telemetry/active",
  "/api/session/api/codex/thread/list",
  "/api/session/api/bots/list",
  "/api/session/api/codex/plugin/installed",
  "/api/session/api/codex/skills/list",
  "/api/session/api/git/branch-info",
  "/api/session/api/filesystem/watch",
  "/api/session/api/filesystem/unwatch",
  "/api/session/api/filesystem/read-directory",
  "/api/session/api/git/status",
  "/api/session/api/git/diff-stats",
  "/api/session/subagents/snapshot",
  "/api/session/api/codex/thread/turns/list",
  "/api/session/git/hunks/read",
  "/api/session/api/git/file-diff-meta",
  "/api/session/api/codex/thread/read",
  "/api/session/api/codex/thread/access",
  "/api/session/api/codex/thread/goal/get",
  "/api/session/api/codex/model/list",
]);

const watchedSources = [
  "apps/web/src/session-mode/features/goals/ThreadGoalCard.tsx",
  "apps/web/src/session-mode/features/goals/goals.css",
  "apps/web/src/session-mode/features/goals/goalMaterialization.ts",
  "apps/web/src/session-mode/components/ui/dialog.tsx",
  "apps/web/src/session-mode/components/codex/composer/Composer.tsx",
  "apps/web/src/session-mode/components/codex/composer/composer-native.css",
  "apps/web/src/session-mode/services/codexService.ts",
  "apps/web/src/session-mode/services/threadGoalState.ts",
  "apps/web/src/session-mode/stores/settings/useThemeStore.ts",
  "apps/web/src/session-mode/session-theme.css",
  "tests/e2e/session-goal-fixture.ts",
  "tests/e2e/session-ux-fixture.ts",
  "tests/e2e/session-goal-control-styles-reference.spec.ts",
  "tests/e2e/session-goal-control-style-native.ts",
  "tests/e2e/session-goal-control-style-evidence.ts",
  "tests/e2e/session-goal-control-style-source.ts",
  "playwright.goal-controls.config.ts",
  ...nativeGoalAssetManifest.map((asset) => asset.path),
];

export type SourceDigest = {
  path: string;
  bytes?: number;
  sha256?: string;
  error?: string;
};

/** Product hashes are captured now, never pinned to a previous implementation. */
export function captureGoalControlSources(): SourceDigest[] {
  return watchedSources.map((path) => {
    try {
      const body = readFileSync(resolve(process.cwd(), path));
      return { path, bytes: body.length, sha256: sha256(body) };
    } catch (error) {
      return { path, error: String(error) };
    }
  });
}

export function compareGoalControlSources(
  before: SourceDigest[],
  after: SourceDigest[],
) {
  const previous = new Map(before.map((entry) => [entry.path, entry]));
  const current = new Map(after.map((entry) => [entry.path, entry]));
  return [...new Set([...previous.keys(), ...current.keys()])]
    .filter((path) => {
      const a = previous.get(path),
        b = current.get(path);
      return !a || !b || a.error || b.error || a.sha256 !== b.sha256;
    })
    .map((path) => ({
      path,
      before: previous.get(path),
      after: current.get(path),
    }));
}
