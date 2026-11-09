import {createHash} from 'node:crypto';

export const SSH_ALIAS_ASSET_REFERENCES = Object.freeze([
  Object.freeze({archiveSha256:'bb88615052255e79b5977885f9a0cc212c268589587c79d4d3b7c4b46e881a95',member:'webview/assets/remote-connections-settings-4dd0ca54883c.js',originalSha256:'7482aef813a976818871f69b226660c46f6c70c239c82b92e6ee5ac26a7c5183',adaptedSha256:'2252f0de13137ebdd120c9809dbe8107a7f265c6814a0e1cb4b4304a4bcc1f58'}),
  Object.freeze({archiveSha256:'1588e6a0e1dcfc615060152ef264d4adf2c3ff6bb7496986c72163b5853e2a2e',member:'webview/assets/remote-connections-settings-8cb3d5b8c7e8.js',originalSha256:'66df8fccb6db35e77e5e5e4ae351ed0ab20a2ba4520e23a755e974ac3e5a5199',adaptedSha256:'5b57a7d622e894dc56dc171acbe3a4aefd2009b820eae03f27ca3c739afe031c'}),
]);
const marker='function ys(){return Kr().discover()}';
const replacement='function ys(){return __kanbanDiscoverServerSshAliases()}';
const prefix='import{discoverServerSshAliases as __kanbanDiscoverServerSshAliases}from"../__host/browser-ssh-alias-discovery.mjs";\n';
const hash=body=>createHash('sha256').update(body).digest('hex');
const fail=code=>Object.assign(new Error('SSH alias interface unavailable'),{code});

export function createBrowserSshAliasAssetAdapter(options) {
  if (!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(key=>key!=='archiveSha256')) throw fail('SSH_ALIAS_UNSUPPORTED_ARCHIVE');
  const ref=SSH_ALIAS_ASSET_REFERENCES.find(ref=>ref.archiveSha256===options.archiveSha256);
  if (!ref) throw fail('SSH_ALIAS_UNSUPPORTED_ARCHIVE');
  return Object.freeze({members:Object.freeze([ref.member]),adapt({member,body}={}){
    if(member!==ref.member)return null;
    if(!(body instanceof Uint8Array)||body.byteLength>256*1024||hash(body)!==ref.originalSha256)throw fail('SSH_ALIAS_DIGEST_MISMATCH');
    const source=new TextDecoder('utf-8',{fatal:true}).decode(body),at=source.indexOf(marker);
    if(at<0||at!==source.lastIndexOf(marker)||source.includes('__kanbanDiscoverServerSshAliases'))throw fail('SSH_ALIAS_PATCH_MISMATCH');
    const adapted=Buffer.from(prefix+source.slice(0,at)+replacement+source.slice(at+marker.length));
    if(hash(adapted)!==ref.adaptedSha256)throw fail('SSH_ALIAS_PATCH_MISMATCH');
    return {body:adapted,originalSha256:ref.originalSha256,adaptedSha256:ref.adaptedSha256};
  }});
}
