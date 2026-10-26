// Read-only evidence scope. Equality is a valid single-profile fixture layout.
import { lstat, realpath, readFile, readlink } from "node:fs/promises";
import { isAbsolute, resolve, relative, sep, dirname, join } from "node:path";
import { captureProcessIdentity } from "../../packages/native-codex-host/refresh-prototype/resources.mjs";

// Only the explicitly created no-login setup process may release its provider.
// Callers still choose the signal; this function never signals a process.
export async function verifyRefreshSetupProcess(fixture, manifestPath) {
  if (
    fixture?.noLoginCopied !== true ||
    !fixture.root?.startsWith("/tmp/ck-ui-life-")
  )
    throw Error("owned no-login refresh fixture required");
  await verifyRefreshProfileRoot(fixture.root, fixture.root);
  if (
    typeof manifestPath !== "string" ||
    !isAbsolute(manifestPath) ||
    resolve(manifestPath) !== manifestPath
  )
    throw Error("canonical private fixture manifest required");
  const manifest = await lstat(manifestPath);
  if (
    !manifest.isFile() ||
    manifest.uid !== process.getuid?.() ||
    (manifest.mode & 0o777) !== 0o600 ||
    manifest.size > 65536 ||
    (await realpath(manifestPath)) !== manifestPath
  )
    throw Error("canonical private fixture manifest required");
  if (
    !Number.isSafeInteger(fixture.setupPid) ||
    fixture.setupPid <= 1 ||
    fixture.setupIdentity?.pid !== fixture.setupPid ||
    (await captureProcessIdentity(fixture.setupPid)).startTicks !==
      fixture.setupIdentity.startTicks
  )
    throw Error("owned fixture setup identity changed");
  const script = join(dirname(manifestPath), "setup.mjs"),
    info = await lstat(script);
  if (
    !info.isFile() ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o022) !== 0 ||
    info.size > 512 * 1024 ||
    (await realpath(script)) !== script
  )
    throw Error("canonical owned fixture setup script required");
  const argv = (await readFile(`/proc/${fixture.setupPid}/cmdline`, "utf8"))
    .split("\0")
    .filter(Boolean);
  if (
    argv.length !== 2 ||
    (await realpath(
      resolve(await readlink(`/proc/${fixture.setupPid}/cwd`), argv[1]),
    )) !== script ||
    (await captureProcessIdentity(fixture.setupPid)).startTicks !==
      fixture.setupIdentity.startTicks
  )
    throw Error("fixture setup script or identity changed");
  return script;
}

export function selectRefreshClientProfile(fixture, index) {
  if (!Number.isInteger(index) || index < 0 || index > 2)
    throw Error("exact refresh client index required");
  const profiles = fixture?.profiles;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  if (
    !Array.isArray(profiles) ||
    ![1, 3].includes(profiles.length) ||
    typeof fixture.root !== "string" ||
    !isAbsolute(fixture.root) ||
    resolve(fixture.root) !== fixture.root ||
    /[\x00-\x1f\x7f]/.test(fixture.root)
  )
    throw Error("explicit one-or-three refresh profile mapping required");
  for (const profile of profiles) {
    if (
      !profile ||
      typeof profile.id !== "string" ||
      !uuid.test(profile.id) ||
      typeof profile.startupId !== "string" ||
      !uuid.test(profile.startupId) ||
      typeof profile.root !== "string" ||
      !isAbsolute(profile.root) ||
      resolve(profile.root) !== profile.root ||
      /[\x00-\x1f\x7f]/.test(profile.root)
    )
      throw Error("invalid private refresh profile mapping");
    const part = relative(fixture.root, profile.root);
    if (part === ".." || part.startsWith(".." + sep) || isAbsolute(part))
      throw Error("refresh profile mapping escaped its fixture");
  }
  for (const field of ["id", "startupId", "root"])
    if (
      new Set(profiles.map((profile) => profile[field])).size !==
      profiles.length
    )
      throw Error("ambiguous private refresh profile mapping");
  for (let a = 0; a < profiles.length; a++)
    for (let b = a + 1; b < profiles.length; b++)
      for (const [left, right] of [
        [profiles[a], profiles[b]],
        [profiles[b], profiles[a]],
      ]) {
        const part = relative(left.root, right.root);
        if (part !== ".." && !part.startsWith(".." + sep) && !isAbsolute(part))
          throw Error("overlapping private refresh profile roots");
      }
  return profiles[profiles.length === 1 ? 0 : index];
}

export async function verifyRefreshProfileRoot(fixtureRoot, profileRoot) {
  for (const path of [fixtureRoot, profileRoot]) {
    if (
      typeof path !== "string" ||
      !isAbsolute(path) ||
      resolve(path) !== path ||
      /[\x00-\x1f\x7f]/.test(path)
    )
      throw Error("canonical owned refresh fixture directory required");
  }
  const part = relative(fixtureRoot, profileRoot);
  if (part === ".." || part.startsWith(".." + sep) || isAbsolute(part))
    throw Error("refresh profile outside its fixture");
  for (const path of new Set([fixtureRoot, profileRoot])) {
    const info = await lstat(path);
    if (
      !info.isDirectory() ||
      info.uid !== process.getuid?.() ||
      (info.mode & 0o777) !== 0o700 ||
      (await realpath(path)) !== path
    )
      throw Error("canonical owned private refresh fixture required");
  }
  return profileRoot;
}
