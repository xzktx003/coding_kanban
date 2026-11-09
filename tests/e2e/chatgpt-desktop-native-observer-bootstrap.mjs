// Explicit fixture-only launcher adaptation. It never changes the source ASAR,
// product launcher, native executable, or any existing process.
import {createHash} from 'node:crypto';
import {isAbsolute,resolve} from 'node:path';
import {CORE_PROMPT,CORE_EXPECTED_REPLY,CORE_FOLLOWUP_PROMPT,CORE_FOLLOWUP_REPLY} from './chatgpt-desktop-account-core-ledger.mjs';

const PIN='94c7547752a6aab56c5c65a7ea3c44241cddcb6f7ccb2ed146f9317cebf2fa9f';
const CLI_SHA='6253fb59fc4c21a9134b2f73237650eaec4a3d9380e5af12f3f1e9040dc24c14';
const NAMES=['create-wrapper.mjs','launcher.mjs','observer.mjs','strict-json.mjs'];
export const CORE_NATIVE_OBSERVER_PINS=Object.freeze({
 'create-wrapper.mjs':'51fb2e2d7c4c7ef03420917f9a56e71e0629acc36593d191ea50961030f9ca4c',
 'launcher.mjs':'fbea623ff4358695038908a711934b25f83cfdd1639b7dcac6e367daafdeb2d1',
 'observer.mjs':'192152e3b37aece3ff44d2def245d92293265dba2f05811090897e5ad6a7f78e',
 'strict-json.mjs':'5926960499942873579b2524dd6b481384fcee6a95147a4cc57d83461712d04c',
});
const sha=body=>createHash('sha256').update(body).digest('hex');
const once=(source,before,after)=>{const i=source.indexOf(before);if(i<0||source.indexOf(before,i+1)!==-1)throw Error('OBSERVER_BOOTSTRAP_MARKER_MISMATCH');return source.slice(0,i)+after+source.slice(i+before.length)};
export function adaptCoreNativeObserverBootstrap({body,files,cliRealPath}={}){
 if(!Buffer.isBuffer(body)||sha(body)!==PIN||!files||typeof files!=='object'||Array.isArray(files)||Object.keys(files).sort().join('\0')!==NAMES.join('\0')||typeof cliRealPath!=='string'||!isAbsolute(cliRealPath)||resolve(cliRealPath)!==cliRealPath||/[\x00-\x1f\x7f]/.test(cliRealPath))throw Error('OBSERVER_BOOTSTRAP_INVALID');
 const payload=[];let size=0;for(const name of NAMES){const file=files[name];if(!file||!Buffer.isBuffer(file.body)||file.sha256!==CORE_NATIVE_OBSERVER_PINS[name]||sha(file.body)!==file.sha256||file.body.length===0||file.body.length>262144)throw Error('OBSERVER_BOOTSTRAP_INVALID');size+=file.body.length;payload.push({name,sha256:file.sha256,base64:file.body.toString('base64')})}if(size>524288)throw Error('OBSERVER_BOOTSTRAP_INVALID');
 let source=body.toString('utf8');source=once(source,'import { existsSync, lstatSync, readFileSync } from "node:fs";','import { existsSync, lstatSync, readFileSync, mkdirSync, openSync, writeFileSync, closeSync, fchmodSync, realpathSync, constants } from "node:fs";\nimport { createHash } from "node:crypto";');
 const setup=`  try {
    const observerDir = "/bridge/observer", eventDir = "/bridge/observer-events", configPath = "/bridge/observer-config.json";
    mkdirSync(observerDir, {mode:0o700}); mkdirSync(eventDir, {mode:0o700});
    const fixedFiles = ${JSON.stringify(payload)};
    for (const entry of fixedFiles) {
      const bytes = Buffer.from(entry.base64,"base64");
      if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw Error("Observer digest mismatch");
      const fd = openSync(join(observerDir,entry.name), constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
      try { writeFileSync(fd,bytes); fchmodSync(fd,0o600); } finally { closeSync(fd); }
    }
    const cliPath=join(runtimeRoot,"resources","codex"), cliRealPath=${JSON.stringify(cliRealPath)};
    if (realpathSync(cliPath)!==cliRealPath) throw Error("Observer CLI path mismatch");
    const observerConfig={version:1,cliPath,cliRealPath,cliSha256:${JSON.stringify(CLI_SHA)},scope:{profileId,generation,viewId: null},expected:{project:join(home,"fixture-project"),prompt:${JSON.stringify(CORE_PROMPT+'\n')},replyMarker:${JSON.stringify(CORE_EXPECTED_REPLY)},followupPrompt:${JSON.stringify(CORE_FOLLOWUP_PROMPT+'\n')},followupReplyMarker:${JSON.stringify(CORE_FOLLOWUP_REPLY)}},outputDir:eventDir};
    const configFd=openSync(configPath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try { writeFileSync(configFd,JSON.stringify(observerConfig)+"\\n"); fchmodSync(configFd,0o600); } finally { closeSync(configFd); }
    const factoryFile=fixedFiles.find(entry=>entry.name==="create-wrapper.mjs");
    const factory=await import("data:text/javascript;base64,"+factoryFile.base64);
    await factory.createPrivateWrapper({wrapperPath:"/bridge/fixture-codex",configPath,nodePath:"/opt/private-node",launcherPath:"/bridge/observer/launcher.mjs",moduleSha256:${JSON.stringify(Object.fromEntries(payload.filter(x=>x.name!=='create-wrapper.mjs').map(x=>[x.name,x.sha256])))} });
    const info=lstatSync("/bridge/fixture-codex");if(!info.isFile()||info.uid!==process.getuid()||(info.mode&0o7777)!==0o700||info.nlink!==1)throw Error("Observer wrapper invalid");
  } catch { process.stderr.write("FIXTURE_CLI_OBSERVER_UNAVAILABLE\\n"); return fail(); }
`;
 source=once(source,'  const env = {',setup+'  const env = {');source=once(source,'    ...connectionEnv,\n  };','    ...connectionEnv,\n    CODEX_CLI_PATH: "/bridge/fixture-codex",\n  };');
 const output=Buffer.from(source);return {body:output,originalSha256:PIN,adaptedSha256:sha(output),observerFiles:Object.fromEntries(payload.map(x=>[x.name,x.sha256]))};
}
