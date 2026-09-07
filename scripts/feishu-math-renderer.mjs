import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const webRequire = createRequire(
  resolve(repositoryRoot, "apps/web/package.json"),
);

const MAX_UNIQUE_FORMULAS = 20;
const MAX_FORMULA_CHARACTERS = 4_000;
const MAX_RENDER_WIDTH = 1_500;
const MAX_RENDER_HEIGHT = 3_000;
const MAX_PNG_BYTES = 10 * 1024 * 1024;
const MIN_RENDER_SCALE = 0.25;
const DEFAULT_TIMEOUT_MS = 20_000;
const MIN_STEP_TIMEOUT_MS = 100;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueBoundedFormulas(formulas) {
  const unique = [];
  const seen = new Set();
  for (const value of formulas ?? []) {
    const formula = String(value ?? "").trim();
    if (
      !formula ||
      formula.length > MAX_FORMULA_CHARACTERS ||
      seen.has(formula)
    ) {
      continue;
    }
    seen.add(formula);
    unique.push(formula);
    if (unique.length >= MAX_UNIQUE_FORMULAS) {
      break;
    }
  }
  return unique;
}

function parseImageKey(stdout) {
  try {
    const response = JSON.parse(stdout);
    if (
      isRecord(response) &&
      response.ok === true &&
      isRecord(response.data) &&
      typeof response.data.image_key === "string" &&
      response.data.image_key.trim()
    ) {
      return response.data.image_key.trim();
    }
  } catch {
    // Fall through to a skipped formula.
  }
  return null;
}

function buildCommandEnv(env) {
  return {
    ...process.env,
    ...env,
    LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
    LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
  };
}

function withPlaywrightLibraryPath(env) {
  const libraryPaths = [
    resolve(
      repositoryRoot,
      ".playwright-runtime/root/usr/lib/x86_64-linux-gnu",
    ),
    resolve(
      repositoryRoot,
      ".playwright-deps/extracted/usr/lib/x86_64-linux-gnu",
    ),
  ].filter((libraryPath) => existsSync(libraryPath));
  return {
    ...env,
    LD_LIBRARY_PATH: [...libraryPaths, env.LD_LIBRARY_PATH]
      .filter(Boolean)
      .join(":"),
  };
}

function remainingTime(deadline) {
  return Math.max(0, deadline - Date.now());
}

function assertTimeRemaining(deadline) {
  const remaining = remainingTime(deadline);
  if (remaining <= 0) {
    throw new Error("Formula rendering timed out");
  }
  return Math.max(MIN_STEP_TIMEOUT_MS, remaining);
}

function loadKatexAssets() {
  const fs = webRequire("node:fs");
  const path = webRequire("node:path");
  const katex = webRequire("katex");
  const cssPath = webRequire.resolve("katex/dist/katex.min.css");
  const cssDirectory = path.dirname(cssPath);
  const css = fs
    .readFileSync(cssPath, "utf8")
    .replace(/url\((?:'|")?fonts\/([^)'"]+)(?:'|")?\)/g, (_match, fileName) => {
      const fontPath = path.resolve(cssDirectory, "fonts", fileName);
      const font = fs.readFileSync(fontPath);
      const mime = fileName.endsWith(".woff2") ? "font/woff2" : "font/woff";
      return `url(data:${mime};base64,${font.toString("base64")})`;
    });
  return { css, katex };
}

async function createDefaultBrowser(env, timeout) {
  const { chromium } = webRequire("playwright");
  return chromium.launch({
    env: withPlaywrightLibraryPath(env),
    headless: true,
    timeout,
  });
}

function scaledDimensions(box) {
  let scale = Math.min(
    1,
    MAX_RENDER_WIDTH / box.width,
    MAX_RENDER_HEIGHT / box.height,
  );
  const scaledPixels = box.width * scale * box.height * scale;
  const maxPixels = Math.floor(MAX_PNG_BYTES / 4);
  if (scaledPixels > maxPixels) {
    scale *= Math.sqrt(maxPixels / scaledPixels);
  }
  return {
    height: Math.max(1, Math.ceil(box.height * scale)),
    scale,
    width: Math.max(1, Math.ceil(box.width * scale)),
  };
}

async function renderFormulaToPngWithBrowser({
  browser,
  formula,
  outputPath,
  katex,
  css,
  deadline,
}) {
  const html = katex.renderToString(formula, {
    displayMode: true,
    maxExpand: 1_000,
    maxSize: 20,
    throwOnError: true,
    trust: false,
  });
  const context = await browser.newContext({
    deviceScaleFactor: 1,
    viewport: { width: MAX_RENDER_WIDTH, height: MAX_RENDER_HEIGHT },
  });
  try {
    await context.route("**/*", (route) => route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(assertTimeRemaining(deadline));
    await page.setContent(
      `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
${css}
html,body{margin:0;padding:0;background:transparent;}
body{display:inline-block;font-size:44px;color:#1f2329;}
#capture{display:inline-block;background:#fff;border-radius:8px;overflow:hidden;}
#formula{display:inline-block;padding:28px 36px;transform-origin:top left;}
</style>
</head>
<body><div id="capture"><div id="formula">${html}</div></div></body>
</html>`,
      { timeout: assertTimeRemaining(deadline), waitUntil: "load" },
    );
    await page.evaluate(() => document.fonts?.ready);
    const box = await page.locator("#formula").evaluate(
      (element) => {
        const rect = element.getBoundingClientRect();
        return {
          height: Math.max(
            rect.height,
            element.scrollHeight,
            element.offsetHeight,
          ),
          width: Math.max(rect.width, element.scrollWidth, element.offsetWidth),
        };
      },
      undefined,
      { timeout: assertTimeRemaining(deadline) },
    );
    if (!box.width || !box.height) {
      throw new Error("Formula did not produce a visible image");
    }
    const dimensions = scaledDimensions(box);
    if (dimensions.scale < MIN_RENDER_SCALE) {
      throw new Error("Formula is too large to render legibly");
    }
    await page.locator("#formula").evaluate(
      (element, scale) => {
        element.style.transform = `scale(${scale})`;
      },
      dimensions.scale,
      { timeout: assertTimeRemaining(deadline) },
    );
    await page.locator("#capture").evaluate(
      (element, { width, height }) => {
        element.style.width = `${width}px`;
        element.style.height = `${height}px`;
      },
      dimensions,
      { timeout: assertTimeRemaining(deadline) },
    );
    await page.locator("#capture").screenshot({
      animations: "disabled",
      omitBackground: true,
      path: outputPath,
      timeout: assertTimeRemaining(deadline),
    });
  } finally {
    await context.close();
  }
}

async function uploadImage({ runCommand, env, timeout, cwd, fileName }) {
  const { stdout } = await runCommand(
    "lark-cli",
    [
      "im",
      "images",
      "create",
      "--format",
      "json",
      "--as",
      "bot",
      "--data",
      JSON.stringify({ image_type: "message" }),
      "--file",
      fileName,
    ],
    {
      cwd,
      env,
      timeout,
    },
  );
  return parseImageKey(stdout);
}

export async function renderFormulaImages(formulas, options = {}) {
  const unique = uniqueBoundedFormulas(formulas);
  const images = new Map();
  if (unique.length === 0) {
    return images;
  }
  if (typeof options.runCommand !== "function") {
    throw new Error("renderFormulaImages requires a runCommand function");
  }

  const timeout = Number.isInteger(options.timeout)
    ? options.timeout
    : DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeout;
  const env = buildCommandEnv(options.env);
  const temporaryDirectory = await mkdtemp(resolve(tmpdir(), "feishu-math-"));
  let browser = null;
  let deadlineTimer = null;

  try {
    const assets = options.renderFormulaToPng ? null : loadKatexAssets();
    browser = options.renderFormulaToPng
      ? null
      : await (options.createBrowser ?? createDefaultBrowser)(
          env,
          assertTimeRemaining(deadline),
        );
    if (browser) {
      deadlineTimer = setTimeout(
        () => {
          browser?.close().catch(() => {});
        },
        Math.max(1, remainingTime(deadline)),
      );
      deadlineTimer.unref?.();
    }

    for (const [index, formula] of unique.entries()) {
      if (Date.now() >= deadline) {
        break;
      }
      const fileName = `formula-${index + 1}.png`;
      const outputPath = resolve(temporaryDirectory, fileName);
      try {
        if (options.renderFormulaToPng) {
          await options.renderFormulaToPng({
            deadline,
            formula,
            outputPath,
            timeout: assertTimeRemaining(deadline),
          });
        } else {
          await renderFormulaToPngWithBrowser({
            browser,
            deadline,
            formula,
            outputPath,
            ...assets,
          });
        }
        if (remainingTime(deadline) <= 0) {
          break;
        }
        const imageKey = await uploadImage({
          runCommand: options.runCommand,
          env,
          timeout: assertTimeRemaining(deadline),
          cwd: temporaryDirectory,
          fileName,
        });
        if (imageKey) {
          images.set(formula, imageKey);
        }
      } catch {
        // Formula rendering is best-effort so the main notification can still send.
      }
    }
  } finally {
    if (deadlineTimer) {
      clearTimeout(deadlineTimer);
    }
    await browser?.close().catch(() => {});
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
  return images;
}
