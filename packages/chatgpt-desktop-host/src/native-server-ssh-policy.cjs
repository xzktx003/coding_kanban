'use strict';
const {createHash}=require('node:crypto');
const ORIGINAL='c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333';
const hash=body=>createHash('sha256').update(body).digest('hex');
const denied=()=>Object.assign(new Error('Server SSH policy unsupported'),{code:'SSH_NATIVE_POLICY_MISMATCH'});
const PATCHES=Object.freeze([
 Object.freeze(['async loadRemoteConnections(){let e=this.restoreSavedAliasConnectionsForExistingRemoteProjects(this.loadSavedRemoteConnections()),',
  'async loadRemoteConnections(){if(globalThis.__kanbanServerSshBridge)return(await globalThis.__kanbanServerSshBridge.catalog(this.loadSavedRemoteConnections())).map(e=>({...e,autoConnect:this.getAutoConnectForRemoteConnection(e)}));let e=this.restoreSavedAliasConnectionsForExistingRemoteProjects(this.loadSavedRemoteConnections()),']),
 Object.freeze(['async saveCodexManagedRemoteSshConnections(e){let t=this.loadSavedRemoteConnections(),',
  'async saveCodexManagedRemoteSshConnections(e){if(globalThis.__kanbanServerSshBridge)await globalThis.__kanbanServerSshBridge.save(e);let t=this.loadSavedRemoteConnections(),']),
 Object.freeze(['dispose(){for(let e of(this.disposed=!0,this.revokeDesktopSession(),this.proxyStreams))e.destroy();this.proxyStreams.clear()}async connect(){if(this.disposed)throw Error("SSH transport is disposed");',
  'dispose(){this.kanbanServerSshConnection?.close();this.kanbanServerSshConnection=null;for(let e of(this.disposed=!0,this.revokeDesktopSession(),this.proxyStreams))e.destroy();this.proxyStreams.clear()}async connect(){if(this.disposed)throw Error("SSH transport is disposed");if(globalThis.__kanbanServerSshBridge){if(this.kanbanServerSshConnection&&this.kanbanServerSshConnection.readyState!==3)throw Error("SSH transport is already connected");this.installedCodexVersion=void 0;let v=await this.getInstalledCodexVersion();if(typeof v!=="string"||!v.length)throw Object.assign(Error("Remote Codex CLI version is unavailable"),{code:"SSH_NATIVE_VERSION_UNAVAILABLE"});if(!(0,el.dlm)(v))throw Error(el.qck+v);let e=await globalThis.__kanbanServerSshBridge.connect(this.options.sshConnection);if(this.disposed){e.close();throw Error("SSH transport is disposed")}return this.kanbanServerSshConnection=e,e;}']),
 Object.freeze(['async runRemoteLoginShellCommand({command:e,context:t,operation:r,timeoutMessage:n,timeoutMs:i=6e4}){',
  'async runRemoteLoginShellCommand({command:e,context:t,operation:r,timeoutMessage:n,timeoutMs:i=6e4}){if(globalThis.__kanbanServerSshBridge){if(r!=="codex_version_probe"||e!=="codex --version")throw Object.assign(Error("Remote command is unavailable through server SSH"),{code:"SSH_NATIVE_REMOTE_COMMAND_UNAVAILABLE"});return globalThis.__kanbanServerSshBridge.probeVersion(this.options.sshConnection);}']),
 Object.freeze(['async runRemoteLoginShellCommandWithoutGate({command:e,context:t,operation:r,timeoutMessage:n,timeoutMs:i=6e4}){',
  'async runRemoteLoginShellCommandWithoutGate({command:e,context:t,operation:r,timeoutMessage:n,timeoutMs:i=6e4}){if(globalThis.__kanbanServerSshBridge){if(r!=="codex_version_probe"||e!=="codex --version")throw Object.assign(Error("Remote command is unavailable through server SSH"),{code:"SSH_NATIVE_REMOTE_COMMAND_UNAVAILABLE"});return globalThis.__kanbanServerSshBridge.probeVersion(this.options.sshConnection);}']),
]);
/** Compose onto a separately verified native-policy result of this original. */
function adaptNativeServerSshChunk({original,base}={}){
 if(!Buffer.isBuffer(original)||hash(original)!==ORIGINAL||!Buffer.isBuffer(base))throw denied();
 const digest=hash(base),expected={
  '0a0c317cca8e59ae237a68e2485e4697dade5589678143aa2bfb82aeae5cf782':'28eaec923cb08b65bafc90f72cdb75a8de83b6319066e6a94e59dd86f592b200',
  '884acb17715a65a33e0bb8df96f8fda5049e5ccd2d42bac0a82d9051d0de7fc4':'85f0b4062f4425dfdaab44f322708131d4d1b3b8aa0c6d46a4376af49d4ade53',
 };
 if(!Object.hasOwn(expected,digest))throw denied();
 let source=base.toString('utf8');for(const [before,after]of PATCHES){const at=source.indexOf(before);if(at<0||at!==source.lastIndexOf(before))throw denied();source=source.slice(0,at)+after+source.slice(at+before.length);}
 const body=Buffer.from(source);if(hash(body)!==expected[digest])throw denied();return{body,originalSha256:ORIGINAL,baseSha256:digest,adaptedSha256:hash(body)};
}
module.exports={adaptNativeServerSshChunk,PATCHES};
