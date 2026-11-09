"use strict";

const { createHash } = require("node:crypto");
const ORIGINAL_SHA256 =
  "c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333";
const digest = (body) => createHash("sha256").update(body).digest("hex");
const fail = (code) =>
  Object.assign(new Error("SSH service unavailable"), { code });
const CLASS_START =
  'class eTi{options;kind="websocket";logger=(0,em.$Cz)("AppServerTransportSshWebsocket");';
const CLASS_END = "}function eTs(";

const SAFE_PROXY_AGENT =
  'if [ -S "\\${SSH_AUTH_SOCK:-}" ] && [ ! -e "\\${CODEX_HOME:-$HOME/.codex}/app-server-control/kanban-${this.kanbanRemoteInstanceId}/forwarded-ssh-agent.sock" ] && [ ! -L "\\${CODEX_HOME:-$HOME/.codex}/app-server-control/kanban-${this.kanbanRemoteInstanceId}/forwarded-ssh-agent.sock" ]; then ln -s -- "$SSH_AUTH_SOCK" "\\${CODEX_HOME:-$HOME/.codex}/app-server-control/kanban-${this.kanbanRemoteInstanceId}/forwarded-ssh-agent.sock"; fi';
const SAFE_PROXY_SOCKET =
  'app-server proxy --sock "\\${CODEX_HOME:-$HOME/.codex}/app-server-control/kanban-${this.kanbanRemoteInstanceId}/app-server.sock"';

const SAFE_START_METHOD = `async startRemoteAppServer(e){let t,r,n=(0,MS.e2)();try{t=await this.runRemoteLoginShellCommand({command:["if command -v ",(0,Mv.hD)(n)," >/dev/null 2>&1; then exit 0; fi; exit ",String(86)].join(""),context:e,operation:"codex_path_probe",timeoutMessage:"SSH: codex path probe timed out"})}catch(e){throw this.createSshSetupError("remote_codex_lookup",e)}if(86===t.code)throw new em.WpG({failureReason:"remote-codex-not-found",message:"No Codex executable found in PATH. Install the Codex CLI on the remote machine.",stage:"remote_codex_lookup"});if(0!==t.code)throw this.createSshSetupError("remote_codex_lookup",Error(await this.getSshCommandFailureMessage(t)),eTs(t.code,t.stderr));let i=await this.getInstalledCodexVersion(e);if(null!=i&&!(0,el.dlm)(i))throw Error(el.qck+i);let id=this.kanbanRemoteInstanceId;if(!/^[a-f0-9]{32}$/.test(id))throw this.createSshSetupError("remote_app_server_start",Error("SSH instance identity unavailable"));let root='"\${CODEX_HOME:-$HOME/.codex}/app-server-control"',dir=root+'/kanban-'+id,socket=dir+'/app-server.sock',agent=dir+'/forwarded-ssh-agent.sock',log=dir+'/app-server.log';let s=['if [ "\${CODEX_SSH_SKIP_APP_SERVER_BOOT:-}" = "true" ]; then exit 0; fi; ','root='+root+'; dir='+dir+'; socket='+socket+'; agent='+agent+'; log='+log+'; ','if [ -S "$socket" ]; then exit 0; fi; ','(umask 077; mkdir -p -- "$root" && mkdir -p -- "$dir" && if [ -S "\${SSH_AUTH_SOCK:-}" ] && [ ! -e "$agent" ] && [ ! -L "$agent" ]; then ln -s -- "$SSH_AUTH_SOCK" "$agent"; fi && : >> "$log") && { SSH_AUTH_SOCK="$agent" nohup ',(0,Mv.hD)(n),' -c features.code_mode_host=true app-server --listen "unix://$socket" </dev/null >> "$log" 2>&1 & }'].join("");this.kanbanSSHBootstrapCommand=s;try{r=await this.runRemoteLoginShellCommand({command:s,context:e,operation:"app_server_bootstrap",timeoutMessage:"SSH: app-server bootstrap timed out"})}catch(e){throw this.createSshSetupError("remote_app_server_start",e)}finally{if(this.kanbanSSHBootstrapCommand===s)this.kanbanSSHBootstrapCommand=null}let{code:a,stdout:o,stderr:l}=r;if(0!==a){this.logger.warning("ssh_websocket_v0.remote_app_server_bootstrap_failed",{safe:{code:a},sensitive:{sshAlias:this.options.sshConnection.alias,sshHost:this.options.sshConnection.host,sshPort:this.options.sshConnection.port,identity:this.options.sshConnection.identity,remoteLogPath:"$CODEX_HOME/app-server-control/kanban-<private>/app-server.log",stdout:o,stderr:l}});let e=await this.getSshCommandFailureMessage(r);throw this.createSshSetupError("remote_app_server_start",Error(e),eTs(a,l))}}`;

function replaceOne(source, before, after, code = "SSH_POLICY_PATCH_MISMATCH") {
  const index = source.indexOf(before);
  if (index < 0 || source.indexOf(before, index + before.length) >= 0)
    throw fail(code);
  return source.slice(0, index) + after + source.slice(index + before.length);
}

function adaptNativeSshBootstrap({ body } = {}) {
  if (!Buffer.isBuffer(body) || digest(body) !== ORIGINAL_SHA256)
    throw fail("SSH_POLICY_DIGEST_MISMATCH");
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw fail("SSH_POLICY_PATCH_MISMATCH");
  }
  const start = source.indexOf(CLASS_START);
  const end = source.indexOf(CLASS_END, start);
  if (
    start < 0 ||
    source.lastIndexOf(CLASS_START) !== start ||
    end <= start ||
    source.lastIndexOf(CLASS_END) !== end
  )
    throw fail("SSH_POLICY_PATCH_MISMATCH");

  let transport = source.slice(start, end + 1);
  // A target hash is shared by unrelated clients. Hold an immutable random
  // namespace for this transport only; reconnects retain it, fresh owners do not.
  transport = replaceOne(
    transport,
    "constructor(e){this.options=e}",
    'constructor(e){this.options=e;Object.defineProperty(this,"kanbanRemoteInstanceId",{value:(0,tb.randomBytes)(16).toString("hex")});this.kanbanSSHBootstrapCommand=null}kanbanIsSafeRemoteCommand(e,t){let n=(0,MS.e2)();if("codex_path_probe"===e)return t===["if command -v ",(0,Mv.hD)(n)," >/dev/null 2>&1; then exit 0; fi; exit ",String(86)].join("");if("codex_version_probe"===e)return t===(0,Mv.hD)(n)+" --version";return "app_server_bootstrap"===e&&t===this.kanbanSSHBootstrapCommand&&!/(?:^|[\\s;])(?:pkill|killall)(?:[\\s;]|$)/.test(t)}',
  );

  const startMethod = "async startRemoteAppServer(e){";
  const startIndex = transport.indexOf(startMethod);
  const startEnd = transport.indexOf("}createSshSetupError(", startIndex);
  if (startIndex < 0 || startEnd <= startIndex)
    throw fail("SSH_POLICY_PATCH_MISMATCH");
  transport =
    transport.slice(0, startIndex) +
    SAFE_START_METHOD +
    transport.slice(startEnd + 1);

  const proxyMethod = "createSshProxyStream(e,t){";
  const proxyIndex = transport.indexOf(proxyMethod);
  const proxyEnd = transport.indexOf("async runWithSshStartupGate(", proxyIndex);
  if (proxyIndex < 0 || proxyEnd <= proxyIndex)
    throw fail("SSH_POLICY_PATCH_MISMATCH");
  const proxy = transport.slice(proxyIndex, proxyEnd);
  const safeProxy = replaceOne(
    replaceOne(proxy, "${ex7}", SAFE_PROXY_AGENT),
    "app-server proxy`,i=null==t?n:",
    SAFE_PROXY_SOCKET + "`,i=null==t?n:",
  );
  transport = transport.slice(0, proxyIndex) + safeProxy + transport.slice(proxyEnd);

  const killMethod = "async killCodexProcess(){";
  const killIndex = transport.indexOf(killMethod);
  const killEnd = transport.indexOf("async runRemoteLoginShellCommand(", killIndex);
  if (killIndex < 0 || killEnd <= killIndex)
    throw fail("SSH_POLICY_PATCH_MISMATCH");
  transport =
    transport.slice(0, killIndex) +
    'async killCodexProcess(){throw Object.assign(new Error("Remote app-server restart is disabled to preserve active remote tasks."),{code:"SSH_REMOTE_RESTART_UNAVAILABLE"})}' +
    transport.slice(killEnd);

  transport = replaceOne(
    transport,
    "async runRemoteLoginShellCommand({command:e,context:t,operation:r,timeoutMessage:n,timeoutMs:i=6e4}){",
    'async runRemoteLoginShellCommand({command:e,context:t,operation:r,timeoutMessage:n,timeoutMs:i=6e4}){if(!this.kanbanIsSafeRemoteCommand(r,e))throw Object.assign(new Error("SSH command is not authorized"),{code:"SSH_REMOTE_COMMAND_UNAVAILABLE"});',
  );
  transport = replaceOne(
    transport,
    "async runRemoteLoginShellCommandWithoutGate({command:e,context:t,operation:r,timeoutMessage:n,timeoutMs:i=6e4}){",
    'async runRemoteLoginShellCommandWithoutGate({command:e,context:t,operation:r,timeoutMessage:n,timeoutMs:i=6e4}){if(!this.kanbanIsSafeRemoteCommand(r,e))throw Object.assign(new Error("SSH command is not authorized"),{code:"SSH_REMOTE_COMMAND_UNAVAILABLE"});',
  );

  const adapted = Buffer.from(
    source.slice(0, start) + transport + source.slice(end + 1),
    "utf8",
  );
  return {
    body: adapted,
    originalSha256: ORIGINAL_SHA256,
    adaptedSha256: digest(adapted),
  };
}
module.exports = { adaptNativeSshBootstrap };
