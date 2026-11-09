// Diagnostic-only response copy of one exact browser-entry build.
import {createHash} from 'node:crypto';
const input='0117f36b3af5a543bab4ddd98a8d4696ccf76d54b4207a7a441664747847240a';
const callback="onFailure: () => fail('ENTRY_BRIDGE_FAILED')";
const catcher="} catch (error) {\n          const code = ['ENTRY_FRAME_LIMIT', 'ENTRY_INVALID_FRAME', 'ENTRY_INVALID_BOOTSTRAP', 'ENTRY_CONNECTION_LOST', 'ENTRY_BRIDGE_FAILED'].includes(error?.code)";
const allowed=['BRIDGE_INVALID_CONFIG','BRIDGE_OUTCOME_UNKNOWN','BRIDGE_QUEUE_FULL','BRIDGE_PENDING_LIMIT','BRIDGE_PORT_LIMIT','BRIDGE_INVALID_MESSAGE','BRIDGE_SCOPE_CHANGED','BRIDGE_UNSUPPORTED_VALUE','BRIDGE_NATIVE_ERROR','BRIDGE_CLOSED','ENTRY_FRAME_LIMIT','ENTRY_INVALID_FRAME','ENTRY_INVALID_BOOTSTRAP','ENTRY_CONNECTION_LOST','ENTRY_BRIDGE_FAILED'];
const snippet=(stage,expr)=>`try{const x=${expr},c=${JSON.stringify(allowed)}.includes(x?.code)?x.code:'other';globalThis.__fixtureEntryStatus?.({stage:${JSON.stringify(stage)},code:c})}catch{}`;
export function insertAccountEntryProbe(source){
 if(typeof source!=='string')throw Error('unsupported input');for(const marker of [callback,catcher]){const i=source.indexOf(marker);if(i<0||i!==source.lastIndexOf(marker))throw Error('unsupported marker')}
 return source.replace(callback,`onFailure: reason => {${snippet('bridge-callback','reason')}fail('ENTRY_BRIDGE_FAILED')}`).replace(catcher,`} catch (error) {\n          ${snippet('message-catch','error')}\n          const code = ['ENTRY_FRAME_LIMIT', 'ENTRY_INVALID_FRAME', 'ENTRY_INVALID_BOOTSTRAP', 'ENTRY_CONNECTION_LOST', 'ENTRY_BRIDGE_FAILED'].includes(error?.code)`);
}
export function adaptAccountEntryProbe(body){if(!Buffer.isBuffer(body)||createHash('sha256').update(body).digest('hex')!==input)throw Error('unsupported input');const text=new TextDecoder('utf-8',{fatal:true}).decode(body),out=Buffer.from(insertAccountEntryProbe(text));return {body:out,originalSha256:input,adaptedSha256:createHash('sha256').update(out).digest('hex')}}
export function normalizeAccountEntryObservation(value,ownedFrame){if(ownedFrame!==true||!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='code,stage'||!['bridge-callback','message-catch'].includes(value.stage)||![...allowed,'other'].includes(value.code))return null;return {stage:value.stage,code:value.code}}
