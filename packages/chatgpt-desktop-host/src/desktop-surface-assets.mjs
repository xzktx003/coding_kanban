import { adaptCodexRendererAsset } from "./renderer-policy.mjs";
import { createHash } from "node:crypto";
import {
  createDesktopLayoutAssetAdapter,
  DESKTOP_LAYOUT_REFERENCE,
} from "./desktop-layout-adapter.mjs";
import { createComposerCapabilityAssetAdapter, SHARED_COMPOSER_CONTENT_REFERENCE } from "./composer-capability-asset-adapter.mjs";
import { createSharedThreadNavigationAssetAdapter } from "./shared-thread-navigation-assets.mjs";
import { createBrowserImageFilePickerAssetAdapter } from "./browser-image-file-picker-assets.mjs";
import { createBrowserSshAliasAssetAdapter } from "./browser-ssh-alias-assets.mjs";
import { createBrowserSharedProjectSelectionAssetAdapter } from "./browser-shared-project-selection-assets.mjs";

const WORK_MEMBER = "webview/assets/app-runtime-b179428fcc1e.js";
const PROJECT_DIALOG = "webview/assets/create-project-dialog-5d973a8dd7a1.js";
const PROJECT_DIALOG_ORIGINAL = "ec965a2d53dd238e4c06747f8d7c93dfcb09151a8ceea3f88dd48b8656a08000";
const PROJECT_DIALOG_ADAPTED = "a0e2737ffc3988b694f8fab360dbf6cb27c9d710e8394f84eade01cec78a90c7";
const PROJECT_DIALOG_LIMIT = 64 * 1024;
const PROJECT_ERROR = "m.get(T).danger(_.formatMessage({id:`projectSetup.createLocalProject.saveError`,defaultMessage:`Failed to create project`,description:`Toast shown when creating a local project fails`}),{errorAnalytics:{toastId:`projectSetup.createLocalProject.saveError`}})";
const PROJECT_HINT = "m.get(T).danger(ge.length===0?_.formatMessage({id:`chatgptDesktop.project.createRootHint`,defaultMessage:`Failed to create project. Choose an existing source folder, or ask the server administrator to configure an allowed project root as the default project parent.`}):_.formatMessage({id:`projectSetup.createLocalProject.saveError`,defaultMessage:`Failed to create project`,description:`Toast shown when creating a local project fails`}),{errorAnalytics:{toastId:`projectSetup.createLocalProject.saveError`}})";
const MAX_RESOURCE_BYTES = 512 * 1024;
const failure = (code) =>
  Object.assign(new Error("Desktop surface assets unavailable"), { code });
const hash = value => createHash("sha256").update(value).digest("hex");

function adaptProjectDialog({body}) {
  const originalSha256 = hash(body);
  if (originalSha256 !== PROJECT_DIALOG_ORIGINAL) throw failure("DESKTOP_SURFACE_PROJECT_DIALOG_MISMATCH");
  const source = new TextDecoder("utf-8", {fatal:true}).decode(body), at = source.indexOf(PROJECT_ERROR);
  if (at < 0 || at !== source.lastIndexOf(PROJECT_ERROR)) throw failure("DESKTOP_SURFACE_PROJECT_DIALOG_MISMATCH");
  const result = Buffer.from(source.slice(0,at) + PROJECT_HINT + source.slice(at + PROJECT_ERROR.length));
  const adaptedSha256 = hash(result);
  if (adaptedSha256 !== PROJECT_DIALOG_ADAPTED) throw failure("DESKTOP_SURFACE_PROJECT_DIALOG_MISMATCH");
  return {body:result,originalSha256,adaptedSha256};
}

/**
 * Server-owned recipe. Each adapter receives the untouched original member;
 * enabling the matching browser initialization is a separate host decision.
 */
export function createDesktopSurfaceAssetAdapter(options) {
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).some(
      (key) => !["archiveSha256", "sharedThread", "splitPane", "sshDiscovery"].includes(key),
    ) ||
    options.archiveSha256 !== DESKTOP_LAYOUT_REFERENCE.archiveSha256 ||
    (Object.hasOwn(options, "sharedThread") &&
      typeof options.sharedThread !== "boolean") ||
    (Object.hasOwn(options, "splitPane") &&
      typeof options.splitPane !== "boolean") ||
    (Object.hasOwn(options, "sshDiscovery") && typeof options.sshDiscovery !== "boolean")
  ) {
    throw failure("DESKTOP_SURFACE_UNSUPPORTED_ARCHIVE");
  }
  const pinned = { archiveSha256: options.archiveSha256 };
  const layout = createDesktopLayoutAssetAdapter({
    ...pinned,
    splitPane: options.splitPane === true,
  });
  const composer = createComposerCapabilityAssetAdapter({...pinned,sharedSubmission:options.sharedThread===true});
  const shared = options.sharedThread
    ? createSharedThreadNavigationAssetAdapter(pinned)
    : null;
  const sharedProject = options.sharedThread ? createBrowserSharedProjectSelectionAssetAdapter(pinned) : null;
  const owners = new Map([[WORK_MEMBER, adaptCodexRendererAsset]]);
  const image = options.splitPane === true && options.sharedThread !== true
    ? createBrowserImageFilePickerAssetAdapter(pinned) : null;
  const ssh = options.sshDiscovery === true ? createBrowserSshAliasAssetAdapter(pinned) : null;
  // Shared+split serves the original project dialog. Both shared recipes add
  // only the pinned submit and explicit execution-choice members.
  const projectHint = options.sharedThread === true && options.splitPane === true
    ? [] : [{members:[PROJECT_DIALOG],adapt:adaptProjectDialog}];
  for (const adapter of [layout, composer, ...projectHint, ...(shared ? [shared] : []), ...(sharedProject ? [sharedProject] : []), ...(image ? [image] : []), ...(ssh ? [ssh] : [])]) {
    for (const member of adapter.members) {
      if (owners.has(member)) throw failure("DESKTOP_SURFACE_DUPLICATE_MEMBER");
      owners.set(member, adapter.adapt);
    }
  }
  return Object.freeze({
    members: Object.freeze([...owners.keys()]),
    adapt({ member, body } = {}) {
      if (typeof member !== "string")
        throw failure("DESKTOP_SURFACE_INVALID_MEMBER");
      const adapt = owners.get(member);
      if (!adapt) return null;
      if (!Buffer.isBuffer(body)) throw failure("DESKTOP_SURFACE_INVALID_BODY");
      const resourceLimit = member===SHARED_COMPOSER_CONTENT_REFERENCE.member?SHARED_COMPOSER_CONTENT_REFERENCE.maxAdaptedBytes:member === PROJECT_DIALOG ? PROJECT_DIALOG_LIMIT : MAX_RESOURCE_BYTES;
      if (body.byteLength > resourceLimit)
        throw failure("DESKTOP_SURFACE_RESOURCE_LIMIT");
      const result = adapt({ member, body });
      if (
        !result ||
        !Buffer.isBuffer(result.body) ||
        result.body.byteLength > resourceLimit
      ) {
        throw failure("DESKTOP_SURFACE_INVALID_OUTPUT");
      }
      return result;
    },
  });
}
