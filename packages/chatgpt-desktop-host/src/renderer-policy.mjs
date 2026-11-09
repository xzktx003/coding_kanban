import { createHash } from 'node:crypto';

// Server-only adapter for one exact, reviewed upstream Mac renderer member.
// Unknown members are untouched; an unexpected target version fails closed.
const MEMBER = 'webview/assets/app-runtime-b179428fcc1e.js';
const ORIGINAL_SHA256 = '8f01cd3d7abe83168a66a85464bb1502f9f1fd1671da1d7840cdcda172956d2a';
const BEFORE = 's=()=>{a==null||o==null||r||i||ws()?.setAuthorization({accountId:a,userId:o,enabled:n})}';
const AFTER = 's=()=>{if(globalThis.__kanbanCodexOnlySurface===true)return;a==null||o==null||r||i||ws()?.setAuthorization({accountId:a,userId:o,enabled:n})}';
const digest = body => createHash('sha256').update(body).digest('hex');
const fail = (code, message) => Object.assign(new Error(message), { code });

/** The caller serves the returned bytes and their adapted digest as one unit. */
export function adaptCodexRendererAsset({ member, body } = {}) {
  if (member !== MEMBER) return null;
  if (!Buffer.isBuffer(body) || digest(body) !== ORIGINAL_SHA256) throw fail('CODEX_POLICY_DIGEST_MISMATCH', 'Unsupported renderer asset');
  let source;
  try { source = new TextDecoder('utf-8', {fatal:true}).decode(body); }
  catch { throw fail('CODEX_POLICY_PATCH_MISMATCH', 'Renderer asset is not UTF-8'); }
  const first = source.indexOf(BEFORE);
  if (first < 0 || first !== source.lastIndexOf(BEFORE)) throw fail('CODEX_POLICY_PATCH_MISMATCH', 'Renderer executor patch target differs');
  const adapted = Buffer.from(source.slice(0, first) + AFTER + source.slice(first + BEFORE.length), 'utf8');
  return {body:adapted, originalSha256:ORIGINAL_SHA256, adaptedSha256:digest(adapted)};
}
