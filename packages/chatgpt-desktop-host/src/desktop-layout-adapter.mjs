import { createHash } from 'node:crypto';

// This adaptation is valid only for the specifically reviewed Mac archive and
// page. It does not mutate, extract, or silently fall back to upstream bytes.
export const DESKTOP_LAYOUT_REFERENCE = Object.freeze({
  archiveSha256: 'bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95',
  pageMember: 'webview/assets/local-conversation-page-50ae20551907.js',
  pageSha256: 'b1293967bb28331c9b90c987c795a24f5ee9f93e1abe6a638e8b82d0bcad89d7',
  adaptedPageSha256: '5e8736a20f792912982010400a4610d077d029b11fbec5d8152f0f78abc02519',
  splitAdaptedPageSha256: 'b9a9d864477661f04eb8de1d947caf21ea2c53b95888514cf4d7aba34558ddad',
});
const MAX_RESOURCE_BYTES = 512 * 1024;
const ORIGINAL_PROPS = 'hideWhenCoveredByRightPanel:U,isTranscriptVisible:W,allowMissingConversation:re,isReadOnly:u,renderComposer:a,renderComposerOverlay:ie,footerContent:ae,onOpenBackgroundAgent:R,onOpenPullRequestSidePanel:H,onOpenSubagentsPanel:B,shouldResume:oe,showSummaryPanel:ce,showMessagingToggle:g,showUtilityBar:!1,showComposer:K';
const MARKER = `(0,Q.jsx)(As,{${ORIGINAL_PROPS}})`;
const NAME = '__chatgptDesktopLayoutBoundary';
const IMPORT = `import{DesktopSelectedPaneBoundary as ${NAME}}from"../__host/desktop-selected-pane-browser.mjs";\n`;
const SPLIT_IMPORT = `import{DesktopSplitPaneBoundary as ${NAME}}from"../__host/desktop-split-pane-browser.mjs";\n`;
const REPLACEMENT = `(0,Q.jsx)(${NAME},{component:As,nativeScope:{hostId:b,conversationId:r,clientThreadId:n},originalProps:{${ORIGINAL_PROPS}}})`;
// Fl's original React compiler cache did not include the three identities,
// because its original GI element did not take them as props. Once the
// boundary receives them, all three must participate in that same cache.
const PATCHES = Object.freeze([
  ['function Fl(e){let t=(0,Hl.c)(100),{clientThreadId:n,conversationId:r,', 'function Fl(e){let t=(0,Hl.c)(103),{clientThreadId:n,conversationId:r,'],
  ['K=c&&ee&&!u,le;t[27]!==R||', 'K=c&&ee&&!u,le;t[100]!==b||t[101]!==r||t[102]!==n||t[27]!==R||'],
  ['t[39]=W,t[40]=re,t[41]=le):le=t[41];let ue=le,de;', 't[39]=W,t[40]=re,t[100]=b,t[101]=r,t[102]=n,t[41]=le):le=t[41];let ue=le,de;'],
  [MARKER, REPLACEMENT],
]);
const failure = (code, message) => Object.assign(new Error(message), { code });
const hash = body => createHash('sha256').update(body).digest('hex');

/**
 * Descriptor for a server-side, byte-budgeted resource adapter. The caller
 * must pass the very same archive pin to openWebviewArchive, keep its asset
 * lease until the adapted response finishes, and use adaptedSha256 for caching.
 */
export function createDesktopLayoutAssetAdapter(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => !['archiveSha256', 'splitPane'].includes(key)) ||
      (Object.hasOwn(options, 'splitPane') && typeof options.splitPane !== 'boolean') ||
      options.archiveSha256 !== DESKTOP_LAYOUT_REFERENCE.archiveSha256) {
    throw failure('DESKTOP_LAYOUT_UNSUPPORTED_ARCHIVE', 'Unsupported desktop archive');
  }
  const splitPane = options.splitPane === true;
  const members = Object.freeze([DESKTOP_LAYOUT_REFERENCE.pageMember]);
  return Object.freeze({
    members,
    adapt({ member, body } = {}) {
      if (typeof member !== 'string') throw failure('DESKTOP_LAYOUT_INVALID_MEMBER', 'Desktop member is required');
      if (member !== DESKTOP_LAYOUT_REFERENCE.pageMember) return null;
      if (!(body instanceof Uint8Array)) throw failure('DESKTOP_LAYOUT_INVALID_BODY', 'Desktop member must be bytes');
      if (body.byteLength > MAX_RESOURCE_BYTES) throw failure('DESKTOP_LAYOUT_RESOURCE_LIMIT', 'Desktop member exceeds the byte budget');
      // Copy a stable snapshot; neither the archive lease nor caller bytes are changed.
      const original = Buffer.from(body);
      const originalSha256 = hash(original);
      if (originalSha256 !== DESKTOP_LAYOUT_REFERENCE.pageSha256) throw failure('DESKTOP_LAYOUT_DIGEST_MISMATCH', 'Unsupported desktop page');
      let source;
      try { source = new TextDecoder('utf-8', { fatal: true }).decode(original); }
      catch { throw failure('DESKTOP_LAYOUT_PATCH_MISMATCH', 'Desktop page is not UTF-8'); }
      if (source.includes(NAME)) {
        throw failure('DESKTOP_LAYOUT_PATCH_MISMATCH', 'Desktop page layout marker differs');
      }
      for (const [before, after] of PATCHES) {
        const at = source.indexOf(before);
        if (at < 0 || at !== source.lastIndexOf(before)) {
          throw failure('DESKTOP_LAYOUT_PATCH_MISMATCH', 'Desktop page layout marker differs');
        }
        source = source.slice(0, at) + after + source.slice(at + before.length);
      }
      const adapted = Buffer.from((splitPane ? SPLIT_IMPORT : IMPORT) + source, 'utf8');
      if (adapted.byteLength > MAX_RESOURCE_BYTES) throw failure('DESKTOP_LAYOUT_RESOURCE_LIMIT', 'Adapted desktop member exceeds the byte budget');
      const adaptedSha256 = hash(adapted);
      const expectedSha256 = splitPane ? DESKTOP_LAYOUT_REFERENCE.splitAdaptedPageSha256 : DESKTOP_LAYOUT_REFERENCE.adaptedPageSha256;
      if (adaptedSha256 !== expectedSha256) throw failure('DESKTOP_LAYOUT_PATCH_MISMATCH', 'Desktop page adaptation digest differs');
      return { body: adapted, originalSha256, adaptedSha256 };
    },
  });
}
