const invalid = () =>
  Object.assign(new Error("Private desktop connection invalid"), {
    code: "CONTAINER_INVALID_CONNECTION",
  });
const KEYS = ["httpProxy", "httpsProxy", "noProxy"];

/** Fixed server registration only. Never reads process.env or a source config. */
export function normalizeDesktopConnection(value) {
  if (value === undefined) return undefined;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value),
    keys = Reflect.ownKeys(descriptors);
  if (
    !keys.length ||
    keys.some(
      (key) => !KEYS.includes(key) || !Object.hasOwn(descriptors[key], "value"),
    ) ||
    !keys.some((key) => key === "httpProxy" || key === "httpsProxy")
  )
    throw invalid();
  const copy = {};
  for (const key of keys) {
    const text = descriptors[key].value;
    if (typeof text !== "string" || /[\x00-\x1f\x7f]/.test(text))
      throw invalid();
    if (key === "noProxy") {
      if (text.length > 4096 || !/^[A-Za-z0-9.,:_*/\[\]\- ]*$/.test(text))
        throw invalid();
    } else {
      if (!text || text.length > 2048 || /\s/.test(text)) throw invalid();
      let url;
      try {
        url = new URL(text);
      } catch {
        throw invalid();
      }
      if (
        !["http:", "https:"].includes(url.protocol) ||
        !url.hostname ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        throw invalid();
    }
    copy[key] = text;
  }
  // Fits the existing 4096-byte private grant; its complete serialized size is
  // checked by the owner before writing. This is not an increased wire budget.
  if (Buffer.byteLength(JSON.stringify(copy)) > 2048) throw invalid();
  return Object.freeze(copy);
}

export function desktopConnectionEnvironment(value) {
  const fixed = normalizeDesktopConnection(value),
    env = {};
  if (fixed?.httpProxy !== undefined) env.http_proxy = fixed.httpProxy;
  if (fixed?.httpsProxy !== undefined) env.https_proxy = fixed.httpsProxy;
  if (fixed?.noProxy !== undefined) {
    env.NO_PROXY = fixed.noProxy;
    env.no_proxy = fixed.noProxy;
  }
  return Object.freeze(env);
}
import { isIP } from "node:net";

/** Original Electron/Chromium switches, scoped to this one new native. */
export function desktopConnectionArguments(value) {
  const fixed = normalizeDesktopConnection(value);
  if (!fixed) return Object.freeze([]);
  const rules = [];
  if (fixed.httpProxy !== undefined) rules.push("http=" + fixed.httpProxy);
  if (fixed.httpsProxy !== undefined) rules.push("https=" + fixed.httpsProxy);
  const args = ["--proxy-server=" + rules.join(";")];
  if (fixed.noProxy !== undefined) {
    const bypass = [];
    for (const raw of fixed.noProxy.split(",")) {
      const rule = raw.trim();
      if (!rule) continue;
      if (isIP(rule) === 6) {
        bypass.push("[" + rule + "]");
        continue;
      }
      if (isIP(rule) || rule === "*" || rule.includes("/")) {
        bypass.push(rule);
        continue;
      }
      const dns = /^(\.?[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)(:[0-9]+)?$/.exec(
        rule,
      );
      if (dns) {
        const name = dns[1].replace(/^\./, "");
        const port = dns[2] ?? "";
        bypass.push(name + port, "*." + name + port);
      } else bypass.push(rule);
    }
    args.push("--proxy-bypass-list=" + [...new Set(bypass)].join(";"));
  }
  return Object.freeze(args);
}
