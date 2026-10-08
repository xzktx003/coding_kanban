import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

/** Dotenv is data; never source shell substitutions from a configuration file. */
export function loadStartupEnv(root, env = process.env) {
  const file = resolve(root, ".env");
  if (!existsSync(file)) return env;
  let parse;
  try {
    ({ parse } = require("dotenv"));
  } catch {
    throw new Error("依赖未安装，请先运行 pnpm install --frozen-lockfile。");
  }
  for (const [key, value] of Object.entries(parse(readFileSync(file)))) {
    if (env[key] === undefined) env[key] = value;
  }
  return env;
}
