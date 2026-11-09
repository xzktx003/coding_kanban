// Diagnostic only: fixed Mac app-primary response copy; never modifies the ASAR.
import { createHash } from 'node:crypto';
const input='ebaecd54561e7e3da76c08b0d900e056424d57b1b23675afad4d7d235599f80b';
const before='function MP(e,{codexLocalAccessStatus:t,currentMode:n,navigate:r,nextMode:i,openHome:a=!1,restoreNavigation:o=!0,startNewConversation:s}){let c=e.get(km);if(i===`codex`){';
const probe='try{let q=e.get(qD),st=[`loading`,`allowed`,`denied`,`error`].includes(t)?t:`other`,so=q?.status===`error`&&[`account-info`,`workspace-settings`].includes(q.source)?q.source:null;globalThis.__fixtureCodexAccess?.({status:st,source:so})}catch{}';
export function insertAccountAccessProbe(source){if(typeof source!=='string')throw Error('unsupported input');const at=source.indexOf(before);if(at<0||at!==source.lastIndexOf(before))throw Error('unsupported marker');return source.slice(0,at)+before+probe+source.slice(at+before.length)}
export function adaptAccountAccessProbe(body){if(!Buffer.isBuffer(body)||createHash('sha256').update(body).digest('hex')!==input)throw Error('unsupported input');const text=new TextDecoder('utf-8',{fatal:true}).decode(body),output=Buffer.from(insertAccountAccessProbe(text));return {body:output,originalSha256:input,adaptedSha256:createHash('sha256').update(output).digest('hex')}}
export function normalizeAccountAccessObservation(value,ownedFrame){
 if(ownedFrame!==true||!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='source,status')return null;
 if(!['loading','allowed','denied','error','other'].includes(value.status))return null;
 if(value.source!==null&&!(value.status==='error'&&['account-info','workspace-settings'].includes(value.source)))return null;
 return {status:value.status,source:value.source};
}
