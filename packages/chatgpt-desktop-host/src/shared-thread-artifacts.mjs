import { constants, openSync, closeSync, fstatSync, lstatSync, realpathSync } from 'node:fs';
import { posix } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const { copySharedRpcTrace } = createRequire(import.meta.url)('./shared-rpc-trace-schema.cjs');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const V8 = /^[0-9a-f]{8}-[0-9a-f]{3}[048c]-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BINDING = ['hostId','runtimeGeneration','daemonGeneration','accountRevision','projectId','threadId','viewId','clientId'];
const authorities = new WeakSet(), receipts = new WeakMap();
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pathOK = value => typeof value === 'string' && value.length > 1 && value.length <= 4096 &&
  posix.isAbsolute(value) && posix.normalize(value) === value && !/[\x00-\x1f\x7f]/.test(value);
const denied = phase => Object.assign(new Error('Shared thread artifact scope is unavailable'), {code:'SHARED_THREAD_ARTIFACT_DENIED',phase});
function record(value, allowed, required = allowed) {
  if (!object(value) || ![Object.prototype,null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key)) ||
      required.some(key => !Object.hasOwn(value,key))) return false;
  return Object.keys(value).every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value,key) ?? {},'value'));
}
const sameBinding = (a,b) => record(a,BINDING) && BINDING.every(key => a[key] === b[key]);
const freeze = value => { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; };
function copy(value) { const text=JSON.stringify(value); if (Buffer.byteLength(text)>64*1024) throw denied('receipt-budget'); return freeze(JSON.parse(text)); }
const stamp = stat => [stat.dev,stat.ino,stat.uid,stat.gid,stat.mode,stat.birthtimeNs].map(String).join(':');

// Fixed original module 38591.CV: UUIDv7 carries milliseconds; the supported
// native UUIDv8 form carries seconds. Date directories use UTC, not host time.
export function deriveSharedThreadArtifactRoot(codexHome,threadId) {
  if (!pathOK(codexHome) || typeof threadId !== 'string') return null;
  let millis;
  if (V7.test(threadId)) millis=Number.parseInt(threadId.slice(0,8)+threadId.slice(9,13),16);
  else if (V8.test(threadId)) millis=1000*Number.parseInt(threadId.slice(0,8),16);
  else return null;
  const date=new Date(millis);
  if (!Number.isFinite(date.getTime())) return null;
  const day=[date.getUTCFullYear(),String(date.getUTCMonth()+1).padStart(2,'0'),String(date.getUTCDate()).padStart(2,'0')].join('/');
  return posix.join(codexHome,'visualizations',day,threadId);
}

export function isSharedThreadArtifactAuthority(value) { return !!value && authorities.has(value); }
export function isSharedThreadArtifactMethod(method) { return method==='fs/getMetadata' || method==='fs/createDirectory'; }

/** Server-only capability for one original thread's standard artifact folder.
 * It does not create directories itself. Only the existing native writer may
 * do so; a successful actual daemon reply mints the one-use proof receipt.
 */
export function createSharedThreadArtifactAuthority({codexHome,projects,verifyCurrentSync,verifyReadSync,
  verifyBindingSync,verifyHistorySync,authorizeDirectorySync,onReceipt,getBindingForThreadSync=()=>null}={}) {
  if (!pathOK(codexHome) || !Array.isArray(projects) || !projects.length || projects.length>8 ||
      [verifyCurrentSync,verifyReadSync,verifyBindingSync,verifyHistorySync,authorizeDirectorySync,onReceipt,getBindingForThreadSync].some(fn=>typeof fn!=='function')) throw denied('configuration');
  const projectRoots=new Set(projects.map(project=>project?.cwd));
  if ([...projectRoots].some(root=>!pathOK(root))) throw denied('project-path');
  let closed=false;
  const fd=openSync(codexHome,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW),base=fstatSync(fd,{bigint:true}),baseIdentity=stamp(base);
  const scopes=new Map(),paths=new Map(),pending=new Map(),used=new Set();
  function baseCurrent() {
    try { const stat=lstatSync(codexHome,{bigint:true});return !closed &&
      stat.isDirectory() && !stat.isSymbolicLink() && stat.uid===BigInt(process.getuid()) && !(Number(stat.mode)&2) &&
      realpathSync.native(codexHome)===codexHome && stamp(stat)===baseIdentity && stamp(fstatSync(fd,{bigint:true}))===baseIdentity; } catch {return false;}
  }
  function current() {try{return baseCurrent()&&verifyCurrentSync()===true&&verifyReadSync()===true;}catch{return false;}}
  function directoryChain(path,allowMissing) {
    const relative=posix.relative(codexHome,path);
    if (relative.startsWith('../') || relative==='..' || posix.isAbsolute(relative)) throw denied('directory-root');
    const chain=new Map();let part=codexHome;
    for (const segment of ['',...relative.split('/')]) {
      if (segment) part=posix.join(part,segment);
      let stat;
      try {stat=lstatSync(part,{bigint:true});} catch(error) {if(allowMissing&&error?.code==='ENOENT')return chain;throw denied('directory-identity');}
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid!==BigInt(process.getuid()) || (Number(stat.mode)&2) || realpathSync.native(part)!==part) throw denied('directory-identity');
      chain.set(part,stamp(stat));
    }
    return chain;
  }
  const chainMatches = chain => {try {return [...chain].every(([path,identity])=>{const stat=lstatSync(path,{bigint:true});return stat.isDirectory()&&!stat.isSymbolicLink()&&stamp(stat)===identity&&realpathSync.native(path)===path;});} catch{return false;}};
  function scopeCurrent(scope) {
    try {return current() && scopes.get(scope.binding.clientId)===scope && verifyBindingSync(scope.binding)===true && verifyHistorySync(scope.binding)===true &&
      authorizeDirectorySync(scope.binding,scope.path)===true && (!scope.directoryIdentity || chainMatches(scope.directoryIdentity));} catch{return false;}
  }
  if (!baseCurrent()) {closeSync(fd);throw denied('account-root');}
  function close() {if(closed)return;closed=true;pending.clear();scopes.clear();paths.clear();used.clear();closeSync(fd);}
  const authority=Object.freeze({
    handlesRequestSync(frame) {
      if(frame?.method==='fs/createDirectory')return true;
      if(frame?.method!=='fs/getMetadata'||!object(frame.params))return false;
      // A recognized method is not a filesystem grant. Startup probes outside
      // these fixed roots retain the existing explicit unsupported-read path.
      const path=Object.getOwnPropertyDescriptor(frame.params,'path');
      return Object.hasOwn(path??{},'value')&&projectRoots.has(path.value);
    },
    registerBinding(binding) {
      if (!record(binding,BINDING) || binding.hostId!=='kanban-shared-cli' || typeof binding.projectId!=='string' || !binding.projectId.length || binding.projectId.length>256 || /[\x00-\x1f\x7f]/.test(binding.projectId) || !Number.isSafeInteger(binding.accountRevision) || binding.accountRevision<0 ||
          !['runtimeGeneration','daemonGeneration','threadId','viewId','clientId'].every(key=>UUID.test(binding[key]??''))) throw denied('binding');
      const path=deriveSharedThreadArtifactRoot(codexHome,binding.threadId);
      if (!path || !current() || verifyBindingSync(binding)!==true || verifyHistorySync(binding)!==true || authorizeDirectorySync(binding,path)!==true) throw denied('binding-current');
      const old=scopes.get(binding.clientId);if(old) {if(!sameBinding(binding,old.binding)||old.path!==path||!scopeCurrent(old))throw denied('binding-replacement');return true;}
      if(scopes.size>=8192)throw denied('binding-budget');
      const scope={binding:copy(binding),path,directoryIdentity:null};scopes.set(binding.clientId,scope);
      let entries=paths.get(path);if(!entries){entries=new Set();paths.set(path,entries);}entries.add(scope);return true;
    },
    beforeWriteSync(frame) {
      if (!record(frame,['id','method','params','jsonrpc','trace'],['id','method','params']) ||
          !(typeof frame.id==='string'&&frame.id.length>0&&frame.id.length<=256||Number.isSafeInteger(frame.id)&&frame.id>=0) ||
          frame.jsonrpc!==undefined&&frame.jsonrpc!=='2.0' || !isSharedThreadArtifactMethod(frame.method)) throw denied('request');
      copySharedRpcTrace(frame.trace);
      const id=typeof frame.id+':'+frame.id;
      if(used.has(id)||used.size>=8192||pending.size>=64||!current())throw denied('request-current');
      const params=frame.params;
      if(!record(params,frame.method==='fs/getMetadata'?['path']:['path','recursive'],['path']) || !pathOK(params.path) ||
         (Object.hasOwn(params,'recursive')&&params.recursive!==null&&typeof params.recursive!=='boolean'))throw denied('request-params');
      let scope=null,prefix=null;
      if(frame.method==='fs/getMetadata') {
        if(!projectRoots.has(params.path))throw denied('metadata-project-root');
      } else {
        scope=[...(paths.get(params.path)??[])].find(scopeCurrent);
        if(!scope) {
          const threadId=posix.basename(params.path),binding=getBindingForThreadSync(threadId);
          // This only consults an existing server binding; it cannot resolve a
          // history row, connect a CLI thread or acquire a writer on its own.
          if(binding&&deriveSharedThreadArtifactRoot(codexHome,threadId)===params.path)authority.registerBinding(binding);
          scope=[...(paths.get(params.path)??[])].find(scopeCurrent);
        }
        if(!scope)throw denied('directory-scope');
        prefix=directoryChain(scope.path,true);
      }
      used.add(id);pending.set(id,{frame:copy(frame),scope,prefix});return true;
    },
    observeReplySync(frame,reply) {
      const id=typeof frame?.id+':'+frame?.id,entry=pending.get(id);
      if(!entry)throw denied('reply-request');pending.delete(id);
      if(JSON.stringify(frame)!==JSON.stringify(entry.frame)||!record(reply,['id','result','error','jsonrpc'],['id']) || reply.id!==frame.id ||
         Object.hasOwn(reply,'result')===Object.hasOwn(reply,'error') || reply.jsonrpc!==undefined&&reply.jsonrpc!=='2.0' || !current() ||
         (entry.scope&&!scopeCurrent(entry.scope)))throw denied('reply-current');
      if(Object.hasOwn(reply,'error'))return Object.freeze({status:'rejected'});
      if(frame.method==='fs/getMetadata') {
        const result=reply.result;
        if(!projectRoots.has(frame.params.path)||!record(result,['createdAtMs','modifiedAtMs','isDirectory','isFile','isSymlink']) ||
           !Number.isSafeInteger(result.createdAtMs)||!Number.isSafeInteger(result.modifiedAtMs)||
           !['isDirectory','isFile','isSymlink'].every(key=>typeof result[key]==='boolean'))throw denied('metadata-response');
        return Object.freeze({status:'metadata'});
      }
      if(!record(reply.result,[])||!chainMatches(entry.prefix))throw denied('directory-response');
      const scope=entry.scope,identity=directoryChain(scope.path,false);
      if(!identity.has(scope.path)||!scopeCurrent(scope))throw denied('directory-response-current');
      scope.directoryIdentity=identity;
      const receipt=Object.freeze({});
      const data=copy({operation:'directory',binding:scope.binding,directoryPath:scope.path,request:entry.frame,response:reply,
        replySha256:createHash('sha256').update(JSON.stringify(reply)).digest('hex')});
      receipts.set(receipt,{scope,data,current:()=>scopeCurrent(scope),consumed:false});
      if(onReceipt(scope.binding,receipt)!==true||!scopeCurrent(scope))throw denied('directory-attestation');
      return Object.freeze({status:'directory'});
    },close,
  });
  authorities.add(authority);return authority;
}

export function verifySharedThreadArtifactDirectorySync(receipt,binding) {
  try {const entry=receipts.get(receipt);return !!entry && sameBinding(binding,entry.data.binding) && !!entry.scope.directoryIdentity && entry.current();} catch{return false;}
}
export function consumeSharedThreadArtifactReceipt(receipt,binding,{operation}={}) {
  const entry=receipts.get(receipt);
  if(!entry||entry.consumed||operation!=='directory'||entry.data.operation!==operation||!verifySharedThreadArtifactDirectorySync(receipt,binding))throw denied('receipt');
  entry.consumed=true;return entry.data;
}
