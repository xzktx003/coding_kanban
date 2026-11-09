import { createBrowserDocument } from "@agent-orchestrator/chatgpt-desktop-host/browser-document";
import { createDesktopSurfaceAssetAdapter } from "@agent-orchestrator/chatgpt-desktop-host/desktop-surface-assets";

// Fixed original Mac build: neither this identity nor the member list is
// selected by a browser request. The archive opener independently verifies it.
const MAC_ARCHIVE_SHA256 =
  "bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95";

export function createChatGptDesktopSurfaceOptions(options: { splitPane?: boolean; sharedThread?: boolean; sshDiscovery?: boolean } = {}) {
  if (!options || Array.isArray(options) || typeof options !== "object" ||
      Object.keys(options).some((key) => !["splitPane", "sharedThread", "sshDiscovery"].includes(key)) ||
      (Object.hasOwn(options, "splitPane") && typeof options.splitPane !== "boolean") ||
      (Object.hasOwn(options, "sharedThread") && typeof options.sharedThread !== "boolean") ||
      (Object.hasOwn(options, "sshDiscovery") && typeof options.sshDiscovery !== "boolean"))
    throw new Error("Invalid fixed desktop surface configuration");
  const splitPane = options.splitPane === true;
  const sharedThread = options.sharedThread === true;
  const version = sharedThread ? (splitPane ? 5 : 3) : (splitPane ? 4 : 2);
  return {
    entryAdapter: (options: {
      body: Uint8Array;
      profileId: string;
      generation: string;
    }) => createBrowserDocument({ ...options, version }),
    assetAdapter: createDesktopSurfaceAssetAdapter({
      archiveSha256: MAC_ARCHIVE_SHA256,
      splitPane,
      sharedThread,
      ...(options.sshDiscovery === true ? { sshDiscovery: true } : {}),
    }),
  };
}
