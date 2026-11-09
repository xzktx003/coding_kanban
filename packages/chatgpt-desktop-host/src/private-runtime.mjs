import { constants, createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, open, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { normalizeProjectRoots } from './fixed-project-mounts.mjs';

const { adaptNativeAppChunk } = createRequire(import.meta.url)('./native-app-policy.cjs');
const { adaptNativeSharedHostChunk } = createRequire(import.meta.url)('./native-shared-host-policy.cjs');

// A new upstream release requires a new reviewed adapter, not caller-supplied pins.
export const PINNED_LINUX_RUNTIME = Object.freeze({
  version: '26.1027.51404',
  binarySha256: '45751964e5d517169752c50748fca162c4eb156e2e362749e57447bf1489859b',
  asarSha256: '1588e6a0e1dcfc615060152ef264d4adf2c3ff6bb7496986c72163b5853e2a2e',
  packageSha256: '2a212914becc15bc6ef280bd6cf0fbb2844b5292450f7f272f812cf2690cb589',
  entrySha256: '466efbe496786705721ae93dd7cd2be7c08d0f760d53adf984dfde77af93fecf',
  chunkSha256: 'c23f63f8ff156b2a92a81ee2870d80ab959ced6ce6232d6fe7e54bbefe11d333',
  preloadSha256: 'aa8be920fd14a9b98eca16c91d97a55105b196698fda36d5063e966620a0c54a',
});
const CHUNK = 'early-bootstrap-439-a0f25ba32c465de1.js';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message) => Object.assign(new Error(message), { code });
const own = (object, name) => object && Object.hasOwn(object, name) ? object[name] : undefined;
const pathOK = value => typeof value === 'string' && value.length > 1 && value.length <= 4096 &&
  isAbsolute(value) && resolve(value) === value && !/[\x00-\x1f\x7f]/.test(value);
const same = (a, b) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'uid'].every(key => a[key] === b[key]);
const inside = (parent, child) => { const part = relative(parent, child); return !part || (part !== '..' && !part.startsWith('../') && !isAbsolute(part)); };

async function safeSourceDirectory(dir, uid) {
  if (await realpath(dir) !== dir) throw fail('PRIVATE_UNSAFE_SOURCE', 'Source path must be canonical');
  const stat = await lstat(dir, {bigint:true});
  if (!stat.isDirectory() || (stat.uid !== 0n && stat.uid !== BigInt(uid)) || (stat.mode & 0o022n)) throw fail('PRIVATE_UNSAFE_SOURCE', 'Source directory is writable by another user');
  for (const entry of await readdir(dir, {withFileTypes:true})) {
    const info = await lstat(join(dir,entry.name), {bigint:true});
    if ((!info.isFile() && !info.isDirectory()) || (info.uid !== 0n && info.uid !== BigInt(uid)) || (info.mode & 0o022n)) throw fail('PRIVATE_UNSAFE_SOURCE', 'Unsafe source resource');
  }
}

async function verifiedFile(path, expected) {
  if (await realpath(path) !== path) throw fail('PRIVATE_UNSAFE_SOURCE', 'Artifact path must be canonical');
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await fd.stat({ bigint: true });
    if (!stat.isFile() || stat.size < 1n || stat.size > 4n * 1024n ** 3n) throw fail('PRIVATE_UNSAFE_SOURCE', 'Invalid artifact');
    const hash = createHash('sha256');
    for await (const chunk of fd.createReadStream({ autoClose: false, start: 0 })) hash.update(chunk);
    if (hash.digest('hex') !== expected) throw fail('PRIVATE_ARTIFACT_DIGEST', 'Linux artifact hash does not match the pinned release');
    if (!same(stat, await fd.stat({ bigint: true })) || !same(stat, await lstat(path, { bigint: true }))) throw fail('PRIVATE_SOURCE_CHANGED', 'Artifact changed during validation');
    return { fd, stat, path };
  } catch (error) { await fd.close(); throw error; }
}

async function readAt(fd, bytes, position) {
  const buffer = Buffer.allocUnsafe(bytes); let offset = 0;
  while (offset < bytes) {
    const { bytesRead } = await fd.read(buffer, offset, bytes - offset, position + offset);
    if (!bytesRead) throw fail('PRIVATE_INVALID_ASAR', 'Truncated archive');
    offset += bytesRead;
  }
  return buffer;
}

async function pinnedMembers(archive) {
  const prefix = await readAt(archive.fd, 16, 0);
  const headerSize = prefix.readUInt32LE(12), pickleSize = prefix.readUInt32LE(4);
  if (prefix.readUInt32LE(0) !== 4 || headerSize > 16 * 1024 * 1024 ||
      pickleSize !== 8 + Math.ceil(headerSize / 4) * 4 || prefix.readUInt32LE(8) !== pickleSize - 4 ||
      BigInt(8 + pickleSize) > archive.stat.size) throw fail('PRIVATE_INVALID_ASAR', 'Invalid archive header');
  let tree;
  try { tree = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readAt(archive.fd, headerSize, 16))); }
  catch { throw fail('PRIVATE_INVALID_ASAR', 'Invalid archive index'); }
  const extract = async (name, expected) => {
    let node = tree;
    for (const part of name.split('/')) node = own(own(node, 'files'), part);
    if (!node || node.files || node.unpacked || node.link || !Number.isSafeInteger(node.size) || node.size < 1 || node.size > 16 * 1024 * 1024 ||
        typeof node.offset !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(node.offset) || node.integrity?.algorithm !== 'SHA256' || node.integrity?.hash !== expected)
      throw fail('PRIVATE_INVALID_ASAR', 'Pinned archive member is missing or invalid');
    const position = 8 + pickleSize + Number(node.offset);
    if (!Number.isSafeInteger(position) || BigInt(position + node.size) > archive.stat.size) throw fail('PRIVATE_INVALID_ASAR', 'Archive member is outside file');
    const value = await readAt(archive.fd, node.size, position);
    if (sha(value) !== expected) throw fail('PRIVATE_ARTIFACT_DIGEST', 'Pinned archive member hash differs');
    return value;
  };
  const [packageBytes, entry, chunk, preload] = await Promise.all([
    extract('package.json', PINNED_LINUX_RUNTIME.packageSha256),
    extract('.vite/build/early-bootstrap.js', PINNED_LINUX_RUNTIME.entrySha256),
    extract('.vite/build/' + CHUNK, PINNED_LINUX_RUNTIME.chunkSha256),
    extract('.vite/build/preload.js', PINNED_LINUX_RUNTIME.preloadSha256),
  ]);
  let pkg;
  try { pkg = JSON.parse(packageBytes.toString('utf8')); } catch { throw fail('PRIVATE_INVALID_ASAR', 'Invalid package metadata'); }
  if (pkg.version !== PINNED_LINUX_RUNTIME.version || pkg.main !== '.vite/build/early-bootstrap.js') throw fail('PRIVATE_ARTIFACT_VERSION', 'Unsupported Linux application version');
  return { pkg, entry, chunk, preload };
}

function buildAsar(entries) {
  const tree = { files: {} }; let offset = 0;
  for (const [name, body] of entries) {
    const hash = sha(body);
    tree.files[name] = { size: body.length, offset: String(offset), integrity: { algorithm:'SHA256', hash, blockSize:4194304, blocks:[hash] } };
    offset += body.length;
  }
  const header = Buffer.from(JSON.stringify(tree));
  const padded = Math.ceil(header.length / 4) * 4;
  const prefix = Buffer.alloc(16 + padded);
  prefix.writeUInt32LE(4, 0); prefix.writeUInt32LE(8 + padded, 4);
  prefix.writeUInt32LE(4 + padded, 8); prefix.writeUInt32LE(header.length, 12);
  header.copy(prefix, 16);
  return Buffer.concat([prefix, ...entries.map(([, body]) => body)]);
}

/** Prepare, but never launch, a fresh Linux host owned by this user. */
export async function preparePrivateRuntime(config) {
  if (!config || !pathOK(config.sourceRoot) || !pathOK(config.runtimeRoot) ||
      !UUID.test(config.profileId ?? '') || !UUID.test(config.generation ?? '')) throw fail('PRIVATE_INVALID_CONFIG', 'Canonical paths and UUID identity are required');
  const sharedField = Object.getOwnPropertyDescriptor(config, 'sharedThread');
  if (sharedField && (!Object.hasOwn(sharedField, 'value') ||
      (sharedField.value !== undefined && typeof sharedField.value !== 'boolean'))) throw fail('PRIVATE_INVALID_SHARED_CONFIG', 'Invalid explicit shared thread configuration');
  const sharedThread = sharedField?.value === true;
  const sshField = Object.getOwnPropertyDescriptor(config, 'serverSsh');
  if (sshField && (!Object.hasOwn(sshField, 'value') ||
      (sshField.value !== undefined && typeof sshField.value !== 'boolean'))) throw fail('PRIVATE_INVALID_SSH_CONFIG', 'Invalid explicit server SSH configuration');
  const serverSsh = sshField?.value === true;
  const toolsField = Object.getOwnPropertyDescriptor(config, 'sharedAppTools');
  if (toolsField && (!Object.hasOwn(toolsField, 'value') ||
      (toolsField.value !== undefined && typeof toolsField.value !== 'boolean') ||
      (toolsField.value === true && !sharedThread))) throw fail('PRIVATE_INVALID_SHARED_CONFIG', 'Invalid explicit shared App Tools configuration');
  const sharedAppTools = toolsField?.value === true;
  let projectRoots;
  try {
    const field = Object.getOwnPropertyDescriptor(config, 'projectRoots');
    if (field && !Object.hasOwn(field, 'value')) throw Error();
    projectRoots = normalizeProjectRoots(field?.value);
    if (projectRoots.some(root => [config.sourceRoot, config.runtimeRoot, fileURLToPath(new URL('.', import.meta.url))].some(protectedPath =>
      inside(root, protectedPath) || inside(protectedPath, root)))) throw Error();
    if (Buffer.byteLength(JSON.stringify(projectRoots)) > 12288) throw Error();
  } catch { throw fail('PRIVATE_INVALID_PROJECTS', 'Explicit canonical project roots are required'); }
  const { sourceRoot, runtimeRoot, profileId, generation } = config;
  if (Buffer.byteLength(join(runtimeRoot, 'home', '.codex', 'ipc', 'ipc.sock'), 'utf8') > 107) throw fail('PRIVATE_PATH_TOO_LONG', 'Private native IPC path exceeds the Unix socket limit; choose a shorter runtime root');
  const parent = dirname(runtimeRoot), uid = process.getuid?.();
  if (uid === undefined || await realpath(parent) !== parent) throw fail('PRIVATE_UNSAFE_PARENT', 'Runtime parent must be a canonical private directory');
  const parentStat = await lstat(parent, { bigint:true });
  if (!parentStat.isDirectory() || parentStat.uid !== BigInt(uid) || (parentStat.mode & 0o7777n) !== 0o700n) throw fail('PRIVATE_UNSAFE_PARENT', 'Runtime parent must be owned and mode 0700');
  try { await lstat(runtimeRoot); throw fail('PRIVATE_EXISTS', 'Runtime destination already exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (inside(sourceRoot, runtimeRoot) || inside(runtimeRoot, sourceRoot)) throw fail('PRIVATE_UNSAFE_SOURCE', 'Source and private runtime must be separate canonical directories');
  await safeSourceDirectory(sourceRoot,uid);
  await safeSourceDirectory(join(sourceRoot,'resources'),uid);
  const sourceBinary = join(sourceRoot, 'ChatGPT'), sourceAsar = join(sourceRoot, 'resources', 'app.asar');
  let binary, archive;
  try {
    binary = await verifiedFile(sourceBinary, PINNED_LINUX_RUNTIME.binarySha256);
    archive = await verifiedFile(sourceAsar, PINNED_LINUX_RUNTIME.asarSha256);
    const members = await pinnedMembers(archive);
    // Refuse unsupported executor or consent patches before creating runtime files.
    const appCompilation = adaptNativeAppChunk({body:members.chunk});
    const sharedCompilation = sharedThread ? adaptNativeSharedHostChunk({body:members.chunk}) : null;
    if (serverSsh) createRequire(import.meta.url)('./native-server-ssh-policy.cjs').adaptNativeServerSshChunk({
      original:members.chunk,base:(sharedCompilation ?? appCompilation).body,
    });
    const policy = await readFile(fileURLToPath(new URL('./codex-surface-policy.cjs', import.meta.url)));
    const consentRouting = await readFile(fileURLToPath(new URL('./project-consent-routing.cjs', import.meta.url)));
    const sshPolicy = await readFile(fileURLToPath(new URL('./ssh-bootstrap-policy.cjs', import.meta.url)));
    const hostPolicy = await readFile(fileURLToPath(new URL('./native-host-policy.cjs', import.meta.url)));
    const appPolicy = await readFile(fileURLToPath(new URL('./native-app-policy.cjs', import.meta.url)));
    const dynamicTools = await readFile(fileURLToPath(new URL('./dynamic-tools-routing.cjs', import.meta.url)));
    const projectPicker = await readFile(fileURLToPath(new URL('./project-folder-picker-native.cjs', import.meta.url)));
    const projectPickerPolicy = await readFile(fileURLToPath(new URL('./project-folder-picker-policy.cjs', import.meta.url)));
    const bootstrap = await readFile(fileURLToPath(new URL('./native-bootstrap.cjs', import.meta.url)));
    const wire = await readFile(fileURLToPath(new URL('./wire-value.mjs', import.meta.url)));
    const viewShim = await readFile(fileURLToPath(new URL('./native-view-shim.js', import.meta.url)));
    const registry = await readFile(fileURLToPath(new URL('./native-view-registry.cjs', import.meta.url)));
    const appHostPorts = await readFile(fileURLToPath(new URL('./native-apphost-ports.cjs', import.meta.url)));
    const sharedNames = ['native-thread-read-identity.cjs','native-shared-desktop-transport.cjs','native-shared-host-factory.cjs','native-shared-mcp-relay.cjs','shared-mcp-wire.cjs','shared-host-registration.cjs','native-shared-host-policy.cjs','native-desktop-account-observer.cjs','native-shared-thread-integration.cjs','native-shared-thread-routing.cjs','native-shared-thread-policy.cjs',
      'shared-thread-authority-channel.cjs','shared-thread-authority-wire.cjs','shared-directory-ipc.cjs','shared-catalog-ipc.cjs',
      'native-shared-thread-submission.cjs','native-shared-thread-creation-routing.cjs','shared-thread-creation-ipc.cjs',
      'native-shared-thread-send-routing.cjs','shared-thread-send-ipc.cjs','shared-thread-send-schema.cjs','shared-permissions-schema.cjs','shared-rpc-trace-schema.cjs'];
    const sharedModules = sharedThread ? await Promise.all(sharedNames.map(async name =>
      [name, await readFile(fileURLToPath(new URL('./' + name, import.meta.url)))])) : [];
    const sshModules = serverSsh ? await Promise.all(['native-server-ssh-bridge.cjs','native-server-ssh-policy.cjs'].map(async name =>
      [name, await readFile(fileURLToPath(new URL('./' + name, import.meta.url)))])) : [];
    const marker = 'o.contextBridge.exposeInMainWorld("electronBridge",{windowType:c,';
    const preloadText = members.preload.toString('utf8');
    if (!preloadText.includes(marker) || preloadText.indexOf(marker) !== preloadText.lastIndexOf(marker)) throw fail('PRIVATE_PATCH_MISMATCH', 'Preload patch target differs');
    const controlPreload = `\n;(()=>{const {contextBridge,ipcRenderer}=require("electron");\n` +
      `contextBridge.exposeInMainWorld("__kanbanOwnedControl",{emit:value=>ipcRenderer.send("kanban-owned:event",value),` +
      `subscribe:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on("kanban-owned:command",listener);` +
      `return()=>ipcRenderer.removeListener("kanban-owned:command",listener)}});` +
      `window.addEventListener("message",event=>{if(event.source!==window||!event.data||event.ports?.length!==1)return;` +
      `const fields=Object.getOwnPropertyDescriptors(event.data),type=fields.type?.value,id=fields.id?.value,portId=fields.portId?.value;` +
      `if(Object.keys(fields).sort().join(",")!=="id,portId,type"||type!=="kanban-owned:app-host-port"||` +
      `!Object.hasOwn(fields.type,"value")||!Object.hasOwn(fields.id,"value")||!Object.hasOwn(fields.portId,"value")||` +
      `!Number.isSafeInteger(id)||id<1||typeof portId!=="string"||portId.length>128||!/^app-host-[1-9][0-9]*$/.test(portId))return;` +
      `ipcRenderer.postMessage("kanban-owned:app-host-port",{id,portId},[event.ports[0]])})})();\n`;
    const privatePreload = preloadText.replace(marker, marker + 'getOwnedSharedObjectSnapshot:()=>({...u}),') + controlPreload;
    const wrapperPackage = Buffer.from(JSON.stringify({ ...members.pkg, main:'main.cjs' }) + '\n');
    const entry = Buffer.from('"use strict";require("./native-bootstrap.cjs").launch();\n');
    const wrapperAsar = buildAsar([['package.json', wrapperPackage], ['main.cjs', entry], ['native-bootstrap.cjs', bootstrap],
      ['wire-value.mjs', wire], ['native-view-shim.js', viewShim], ['native-view-registry.cjs', registry], ['native-apphost-ports.cjs', appHostPorts], ['codex-surface-policy.cjs', policy],
      ['project-consent-routing.cjs', consentRouting], ['ssh-bootstrap-policy.cjs', sshPolicy], ['native-host-policy.cjs', hostPolicy],
      ['native-app-policy.cjs', appPolicy], ['dynamic-tools-routing.cjs', dynamicTools],
      ['project-folder-picker-native.cjs', projectPicker], ['project-folder-picker-policy.cjs', projectPickerPolicy], ...sharedModules, ...sshModules]);
    await mkdir(runtimeRoot, { mode:0o700 });
    const resources = join(runtimeRoot, 'resources'), home = join(runtimeRoot, 'home');
    await mkdir(resources, { mode:0o700 }); await mkdir(home, { mode:0o700 });
    for (const entry of await readdir(sourceRoot, { withFileTypes:true })) {
      if (entry.name !== 'ChatGPT' && entry.name !== 'resources') await symlink(join(sourceRoot, entry.name), join(runtimeRoot, entry.name));
    }
    for (const entry of await readdir(join(sourceRoot, 'resources'), { withFileTypes:true })) {
      if (entry.name !== 'app.asar') await symlink(join(sourceRoot, 'resources', entry.name), join(resources, entry.name));
    }
    const executable = join(runtimeRoot, 'ChatGPT');
    await copyFile(sourceBinary, executable, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
    const copied = createHash('sha256'); for await (const part of createReadStream(executable)) copied.update(part);
    if (copied.digest('hex') !== PINNED_LINUX_RUNTIME.binarySha256 || !same(binary.stat, await lstat(sourceBinary, { bigint:true })) ||
        !same(archive.stat, await lstat(sourceAsar, { bigint:true }))) throw fail('PRIVATE_SOURCE_CHANGED', 'Original artifact changed during preparation');
    const configPath = join(resources, 'private-config.json');
    const privateConfig = { version:1, profileId, generation, runtimeRoot, home, projectRoots, originalAsar:sourceAsar, originalMain:'.vite/build/early-bootstrap.js',
      binarySha256:PINNED_LINUX_RUNTIME.binarySha256, asarSha256:PINNED_LINUX_RUNTIME.asarSha256,
      entrySha256:PINNED_LINUX_RUNTIME.entrySha256, chunkSha256:PINNED_LINUX_RUNTIME.chunkSha256,
      preloadSha256:PINNED_LINUX_RUNTIME.preloadSha256, privatePreloadSha256:sha(privatePreload) };
    if (sharedThread) privateConfig.sharedThread = { version:sharedAppTools ? 2 : 1 };
    if (serverSsh) privateConfig.serverSsh = { version:1 };
    const encodedPrivateConfig = JSON.stringify(privateConfig) + '\n';
    if (Buffer.byteLength(encodedPrivateConfig) > 16384) throw fail('PRIVATE_INVALID_PROJECTS', 'Private runtime configuration exceeds its existing budget');
    await writeFile(join(resources, 'private-preload.js'), privatePreload, { mode:0o600, flag:'wx' });
    await writeFile(configPath, encodedPrivateConfig, { mode:0o600, flag:'wx' });
    await writeFile(join(resources, 'app.asar'), wrapperAsar, { mode:0o600, flag:'wx' });
    return Object.freeze({ executable, home, configPath, profileId, generation,
      env:Object.freeze({ HOME:home, XDG_CONFIG_HOME:join(home, '.config'), XDG_CACHE_HOME:join(home, '.cache') }),
      args:Object.freeze(['--user-data-dir=' + join(home, 'user-data')]) });
  } finally { await binary?.fd.close(); await archive?.fd.close(); }
}
