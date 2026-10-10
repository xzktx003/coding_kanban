import { spawn } from "node:child_process";
import { isAbsolute } from "node:path";
import { HttpError } from "../core/json.js";
export function cleanString(
  value: unknown,
  name: string,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && !value.trim()) ||
    /[\x00-\x1f]/.test(value) ||
    value.length > 32768
  )
    throw new HttpError(400, `Invalid ${name}`);
  return value;
}
export function absolutePath(value: unknown, name = "path"): string {
  const path = cleanString(value, name);
  if (!isAbsolute(path)) throw new HttpError(400, `${name} must be absolute`);
  return path;
}
export function run(
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    timeout?: number;
    maxBytes?: number;
  } = {},
): Promise<string> {
  cleanString(command, "command");
  for (const arg of args)
    if (arg.includes("\0"))
      throw new HttpError(400, "Invalid command argument");
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env,
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    let error = "";
    let bytes = 0;
    let failure: Error | undefined;
    const timer = setTimeout(() => {
      failure = new Error("Command timed out");
      child.kill();
    }, options.timeout ?? 30000);
    timer.unref();
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > (options.maxBytes ?? 1024 * 1024)) {
        failure = new Error("Command output limit exceeded");
        child.kill();
      } else output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      error = (error + chunk.toString()).slice(-4000);
    });
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0)
        reject(new Error(`Command failed (${code}): ${error}`));
      else resolve(output);
    });
  });
}
export class Serial {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn);
    this.tail = next.catch(() => {});
    return next;
  }
}
