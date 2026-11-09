import { constants } from 'node:fs';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const fail = () => new Error('Invalid ChatGPT candidate web configuration');
const pathOK = value => typeof value === 'string' && isAbsolute(value) && resolve(value) === value && value.length <= 4096 && !/[\x00-\x1f\x7f"\\]/.test(value);
const portOK = value => typeof value === 'string' && /^[1-9][0-9]{0,4}$/.test(value) && Number(value) <= 65535;
function hostOK(value) {
  if (typeof value !== 'string' || value.length > 253 || !value) return false;
  if (value.startsWith('[') && value.endsWith(']')) return isIP(value.slice(1,-1)) === 6;
  return isIP(value) === 4 || /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(value);
}

/** Explicitly select the existing Kanban backend; never accept an HTTP-provided upstream. */
export function candidateWebEnvironment(candidate, kanban) {
  if (!candidate || !kanban || !hostOK(kanban.WEB_BACKEND_HOST) || !portOK(kanban.WEB_BACKEND_PORT) ||
      !portOK(candidate.CHATGPT_DESKTOP_CANDIDATE_PORT) || !portOK(candidate.WEB_PORT) ||
      candidate.VITE_DEV_HTTPS !== '1' || !pathOK(candidate.VITE_DEV_HTTPS_CERT) || !pathOK(candidate.VITE_DEV_HTTPS_KEY)) throw fail();
  const selected = {
    CHATGPT_DESKTOP_CANDIDATE_PORT: candidate.CHATGPT_DESKTOP_CANDIDATE_PORT,
    WEB_PORT: candidate.WEB_PORT,
    WEB_HOST: '0.0.0.0',
    VITE_DEV_HTTPS: '1',
    VITE_DEV_HTTPS_CERT: candidate.VITE_DEV_HTTPS_CERT,
    VITE_DEV_HTTPS_KEY: candidate.VITE_DEV_HTTPS_KEY,
    WEB_BACKEND_HOST: kanban.WEB_BACKEND_HOST,
    WEB_BACKEND_PORT: kanban.WEB_BACKEND_PORT,
  };
  for (const key of ['CHATGPT_DESKTOP_PROFILE_FILE','CHATGPT_DESKTOP_CANDIDATE_AUTH_TOKEN_FILE','VITE_DEV_HTTPS_CA_CERT']) {
    if (candidate[key] !== undefined) {
      if (!pathOK(candidate[key])) throw fail();
      selected[key] = candidate[key];
    }
  }
  return Object.freeze(selected);
}

async function readConfig(file, privateFile) {
  if (!pathOK(file) || await realpath(file) !== file) throw fail();
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({bigint:true});
    if (!before.isFile() || before.uid !== BigInt(process.getuid()) || before.size > 65536n ||
        (privateFile && (before.mode & 0o7777n) !== 0o600n)) throw fail();
    const data = await handle.readFile();
    const after = await handle.stat({bigint:true}), current = await lstat(file,{bigint:true});
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size ||
        before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs ||
        before.dev !== current.dev || before.ino !== current.ino) throw fail();
    return parse(data);
  } finally { await handle.close(); }
}

export async function prepareCandidateWebEnv(candidateFile, kanbanFile, outputFile) {
  if (!pathOK(outputFile)) throw fail();
  const parent = dirname(outputFile), info = await lstat(parent,{bigint:true});
  if (await realpath(parent) !== parent || !info.isDirectory() || info.uid !== BigInt(process.getuid()) || (info.mode & 0o7777n) !== 0o700n) throw fail();
  const candidate = await readConfig(candidateFile, true), kanban = await readConfig(kanbanFile, false);
  const env = candidateWebEnvironment(candidate, kanban);
  const data = Object.entries(env).map(([key,value]) => `${key}=${JSON.stringify(value)}\n`).join('');
  const output = await open(outputFile, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await output.writeFile(data); } finally { await output.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if (args.length !== 6 || args[0] !== '--candidate-env' || args[2] !== '--kanban-env' || args[4] !== '--output') {
    process.stderr.write('Invalid ChatGPT candidate web configuration\n'); process.exitCode=1;
  } else {
    prepareCandidateWebEnv(args[1],args[3],args[5]).then(
      () => process.stdout.write('Candidate web configuration prepared\n'),
      () => { process.stderr.write('Invalid ChatGPT candidate web configuration\n'); process.exitCode=1; },
    );
  }
}
