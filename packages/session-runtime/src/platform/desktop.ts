import { access, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join, delimiter } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { HttpError, bodyObject } from "../core/json.js";
import { absolutePath, cleanString, run, Serial } from "./common.js";
export class Desktop {
  private active = new Set<string>();
  private inhibitor?: ChildProcess;
  private serial = new Serial();
  constructor(private env: NodeJS.ProcessEnv) {}
  async check(appName: unknown) {
    const name = cleanString(appName, "appName");
    if (name.includes("/") || name.includes("\\") || name.startsWith("-"))
      throw new HttpError(400, "Invalid appName");
    if (process.platform === "darwin") {
      const normalized = name.toLowerCase().replace(/\.app$/, "") + ".app";
      for (const root of [
        "/Applications",
        "/System/Applications",
        "/Applications/Utilities",
        join(this.env.HOME ?? "", "Applications"),
      ]) {
        for (const entry of await readdir(root).catch(() => []))
          if (entry.toLowerCase() === normalized)
            return { installed: true, path: join(root, entry) };
      }
    }
    for (const root of (this.env.PATH ?? "").split(delimiter).filter(Boolean)) {
      for (const ext of process.platform === "win32"
        ? ["", ".exe", ".cmd", ".bat"]
        : [""]) {
        const path = join(root, name + ext);
        try {
          await access(path, constants.X_OK);
          if ((await stat(path)).isFile()) return { installed: true, path };
        } catch {}
      }
    }
    return { installed: false, path: null };
  }
  async open(pathValue: unknown, optionsValue: unknown) {
    const path = absolutePath(pathValue);
    if (!(await stat(path)).isDirectory())
      throw new HttpError(400, "Workspace must be a directory");
    const options = bodyObject(optionsValue);
    if (
      !Array.isArray(options.args) ||
      options.args.some((a) => typeof a !== "string" || a.includes("\0"))
    )
      throw new HttpError(400, "Invalid args");
    const args = options.args as string[];
    const app = options.app ?? options.command;
    if (app == null) return;
    const command = cleanString(app, "application");
    if (command.startsWith("-"))
      throw new HttpError(400, "Invalid application");
    if (process.platform === "darwin" && options.app)
      await run(
        "open",
        ["-a", command, path, ...(args.length ? ["--args", ...args] : [])],
        { env: this.env },
      );
    else await run(command, [...args, path], { env: this.env });
  }
  prevent(id?: string) {
    return this.serial.run(async () => {
      const key = id ?? "__global__";
      if (this.active.has(key)) return;
      if (!this.inhibitor) {
        const ready = "kanban-inhibit-ready";
        const hold = [
          process.execPath,
          "-e",
          `process.stdout.write("${ready}\\n");process.stdin.resume();process.stdin.on("end",()=>process.exit(0));`,
        ];
        let command: string, args: string[];
        if (process.platform === "darwin") {
          command = "caffeinate";
          args = ["-i", ...hold];
        } else if (process.platform === "win32") {
          command = "powershell.exe";
          args = [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `Add-Type -Name Power -Namespace Session -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);'; $result=[Session.Power]::SetThreadExecutionState(0x80000001); if($result -eq 0){exit 1}; Write-Output '${ready}'; [Console]::In.ReadToEnd() | Out-Null`,
          ];
        } else {
          command = "systemd-inhibit";
          args = [
            "--what=idle:sleep",
            "--who=Kanban session",
            "--why=Active session",
            "--mode=block",
            ...hold,
          ];
        }
        const child = spawn(command, args, {
          env: this.env,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
        await new Promise<void>((resolve, reject) => {
          let error = "",
            output = "";
          const timer = setTimeout(() => {
            child.stdin.end();
            child.kill();
            reject(new Error("Timed out acquiring sleep inhibitor"));
          }, 10000);
          child.stdout.on("data", (chunk: Buffer) => {
            output = (output + chunk.toString()).slice(-1024);
            if (
              output.includes(ready + "\n") ||
              output.includes(ready + "\r\n")
            ) {
              clearTimeout(timer);
              resolve();
            }
          });
          child.stderr.on("data", (chunk: Buffer) => {
            error = (error + chunk.toString()).slice(-2000);
          });
          child.once("error", (e) => {
            clearTimeout(timer);
            reject(e);
          });
          child.once("exit", () => {
            clearTimeout(timer);
            reject(new Error(`Could not prevent sleep: ${error}`));
            if (this.inhibitor === child) {
              this.inhibitor = undefined;
              this.active.clear();
            }
          });
        });
        this.inhibitor = child;
      }
      this.active.add(key);
    });
  }
  allow(id?: string) {
    return this.serial.run(async () => {
      if (id === undefined) this.active.clear();
      else this.active.delete(id);
      if (!this.active.size) {
        const child = this.inhibitor;
        this.inhibitor = undefined;
        if (child)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(() => child.kill(), 2000);
            const force = setTimeout(() => child.kill("SIGKILL"), 4000);
            child.once("exit", () => {
              clearTimeout(timer);
              clearTimeout(force);
              resolve();
            });
            child.stdin?.end();
          });
      }
    });
  }
  close() {
    return this.allow();
  }
}
