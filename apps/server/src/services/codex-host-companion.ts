import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
/** The bearer token lives in private server files and is never returned to the browser. */
export class CodexHostCompanionCredential {
  readonly file: string;
  private token: string;
  constructor(dataHome: string) {
    this.file = join(dataHome, "codex-host-companion.json");
    this.token = randomBytes(32).toString("hex");
  }
  async write(origin: string) {
    const url = new URL(origin);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.username ||
      url.password
    )
      throw new Error("宿主扩展只允许连接本机网关");
    try {
      const previous = JSON.parse(await readFile(this.file, "utf8"));
      if (/^[a-f0-9]{64}$/.test(previous.token)) this.token = previous.token;
    } catch {
      /* First start uses a fresh private credential. */
    }
    await mkdir(join(this.file, ".."), { recursive: true, mode: 0o700 });
    await writeFile(
      this.file,
      JSON.stringify({ version: 1, origin: url.origin, token: this.token }),
      { mode: 0o600 },
    );
    await chmod(this.file, 0o600);
  }
  valid(authorization?: string) {
    const actual = authorization?.replace(/^Bearer /, "") ?? "";
    const received = Buffer.from(actual),
      expected = Buffer.from(this.token);
    return (
      /^[a-f0-9]{64}$/.test(actual) &&
      received.length === expected.length &&
      timingSafeEqual(received, expected)
    );
  }
}
/** Install only in the manager's selected extension directory; this never reloads an editor. */
export async function prepareCodexHostCompanion(options: {
  packageRoot: string;
  extensionsDir: string;
  workspacesDir: string;
  credentialFile: string;
}) {
  const target = join(
    options.extensionsDir,
    "coding-kanban.codex-host-bridge-0.1.0",
  );
  await mkdir(target, { recursive: true });
  for (const name of [
    "package.json",
    "extension.cjs",
    "lsp-mcp.cjs",
    "LICENSE",
  ])
    await cp(join(options.packageRoot, name), join(target, name));
  await mkdir(options.workspacesDir, { recursive: true, mode: 0o700 });
  // Managed .code-workspace files are outside repository files. The companion
  // discovers this private sibling, never a credential provided by web content.
  await writeFile(
    join(options.workspacesDir, "codex-host-companion.json"),
    await readFile(options.credentialFile),
    { mode: 0o600 },
  );
  await chmod(join(options.workspacesDir, "codex-host-companion.json"), 0o600);
  return target;
}
