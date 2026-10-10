/* Independent Coding Kanban implementation. No native plugin account or telemetry code. */
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const http = require("node:http");
const https = require("node:https");
function request(config, endpoint, body) {
  const url = new URL(
    "/api/session/codex-host/companion/" + endpoint,
    config.origin,
  );
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Companion requires a loopback gateway");
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method: "POST",
        timeout: 5000,
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + config.token,
          "content-length": Buffer.byteLength(data),
        },
      },
      (response) => {
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          text += chunk;
          if (text.length > 1024 * 1024)
            req.destroy(new Error("Companion response too large"));
        });
        response.on("end", () => {
          try {
            const result = JSON.parse(text);
            if (response.statusCode >= 400)
              reject(new Error(result.error || "Companion connection failed"));
            else resolve(result);
          } catch {
            reject(new Error("Invalid companion response"));
          }
        });
      },
    );
    req.on("timeout", () =>
      req.destroy(new Error("Companion gateway timed out")),
    );
    req.on("error", reject);
    req.end(data);
  });
}
function createHost(vscode, cwd) {
  const diffDocuments = new Map();
  const provider = {
    provideTextDocumentContent: (uri) =>
      diffDocuments.get(uri.toString()) || "",
  };
  const within = async (value, exists = true) => {
    if (
      typeof value !== "string" ||
      !path.isAbsolute(value) ||
      /[\0-\x1f]/.test(value)
    )
      throw new Error("Invalid editor file");
    const full = exists ? await fs.realpath(value) : value;
    const relative = path.relative(cwd, full);
    if (
      relative === ".." ||
      relative.startsWith("../") ||
      path.isAbsolute(relative)
    )
      throw new Error("File is outside the bound session workspace");
    return full;
  };
  async function context(selectionOnly, document, range) {
    const editor = vscode.window.activeTextEditor;
    document = document || editor?.document;
    if (!document || document.uri.scheme !== "file")
      throw new Error("请在该项目中打开文本文件");
    const full = await within(document.uri.fsPath);
    range =
      range ||
      (selectionOnly && !editor?.selection.isEmpty ? editor.selection : null);
    if (selectionOnly && !range) throw new Error("请先在编辑器中选择文字");
    const text = document.getText(range || undefined);
    if (text.length > 180000 || text.includes("\0"))
      throw new Error("上下文过长，请选择需要的文本片段");
    return {
      path: full,
      text,
      languageId: document.languageId,
      dirty: document.isDirty,
      ...(range
        ? {
            range: {
              start: range.start.line + 1,
              end:
                range.end.line +
                (range.end.character === 0 && range.end.line > range.start.line
                  ? 0
                  : 1),
              startColumn: range.start.character + 1,
              endColumn: range.end.character + 1,
            },
          }
        : {}),
    };
  }
  async function execute(command) {
    if (command.type === "context") return context(command.selectionOnly);
    if (command.type === "workspaceState") {
      const dirtyPaths = [];
      for (const document of vscode.workspace.textDocuments || [])
        if (document.isDirty && document.uri.scheme === "file") {
          try {
            dirtyPaths.push(await within(document.uri.fsPath));
          } catch {
            /* Other projects are not part of this owner. */
          }
        }
      return { dirtyPaths };
    }
    if (command.type === "openLocation") {
      const document = await vscode.workspace.openTextDocument(
        vscode.Uri.file(await within(command.path)),
      );
      const editor = await vscode.window.showTextDocument(document, {
        preview: false,
      });
      const position = document.validatePosition(
        new vscode.Position((command.line || 1) - 1, (command.column || 1) - 1),
      );
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(
        new vscode.Range(position, position),
        vscode.TextEditorRevealType.InCenterIfOutsideViewport,
      );
      return {
        opened: true,
        path: document.uri.fsPath,
        line: position.line + 1,
      };
    }
    if (command.type === "showDiff") {
      const full = await within(command.path, false),
        id = crypto.randomUUID();
      const before = vscode.Uri.parse(
        "coding-kanban-diff:/" +
          id +
          "/before/" +
          encodeURIComponent(path.basename(full)),
      );
      const after = vscode.Uri.parse(
        "coding-kanban-diff:/" +
          id +
          "/after/" +
          encodeURIComponent(path.basename(full)),
      );
      diffDocuments.set(before.toString(), command.before);
      diffDocuments.set(after.toString(), command.after);
      await vscode.commands.executeCommand(
        "vscode.diff",
        before,
        after,
        command.title || path.basename(full),
        { preview: false },
      );
      return { opened: true, path: full };
    }
    if (command.type === "definitions") {
      if (
        !vscode.workspace
          .getConfiguration("codingKanban.host")
          .get("lsp", false)
      )
        throw new Error("可选语言服务能力未启用");
      const uri = vscode.Uri.file(await within(command.path));
      const results = await vscode.commands.executeCommand(
        "vscode.executeDefinitionProvider",
        uri,
        new vscode.Position(command.line - 1, command.column - 1),
      );
      const locations = [];
      for (const item of results || []) {
        const uri = item.uri || item.targetUri,
          range = item.range || item.targetSelectionRange;
        if (uri?.scheme !== "file" || !range) continue;
        try {
          locations.push({
            path: await within(uri.fsPath),
            line: range.start.line + 1,
            column: range.start.character + 1,
          });
        } catch {
          /* Never expose paths outside this owner workspace. */
        }
      }
      return { locations };
    }
    throw new Error("Unsupported companion command");
  }
  return { context, execute, provider };
}
function createTodoCodeLenses(vscode, cwd, document) {
  const relative = path.relative(cwd, document.uri.fsPath);
  if (
    !["file", "vscode-remote"].includes(document.uri.scheme) ||
    relative === ".." ||
    relative.startsWith("../") ||
    path.isAbsolute(relative)
  )
    return [];
  const lenses = [];
  for (let i = 0; i < document.lineCount; i++)
    if (/\bTODO\b/.test(document.lineAt(i).text)) {
      const range = document.lineAt(i).range;
      // Native commands marshal URI/Range values; a TextDocument is a live object.
      lenses.push(
        new vscode.CodeLens(range, {
          title: "添加 TODO 到看板会话",
          command: "codingKanban.addEditorContext",
          arguments: [document.uri, range],
        }),
      );
    }
  return lenses;
}
async function activate(extensionContext) {
  const vscode = require("vscode");
  const folder = vscode.workspace.workspaceFolders?.[0];
  const output = vscode.window.createOutputChannel(
    "Coding Kanban Editor Context",
  );
  extensionContext.subscriptions.push(output);
  output.appendLine(
    "Companion v1 activated; workspace scheme=" +
      (folder?.uri.scheme || "none") +
      "; workspace-file scheme=" +
      (vscode.workspace.workspaceFile?.scheme || "none"),
  );
  if (!folder || !["file", "vscode-remote"].includes(folder.uri.scheme)) {
    output.appendLine("Unavailable: this is not a local server workspace");
    return;
  }
  const cwd = await fs.realpath(folder.uri.fsPath),
    instanceId = crypto.randomUUID();
  const host = createHost(vscode, cwd);
  extensionContext.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(
      "coding-kanban-diff",
      host.provider,
    ),
  );
  let config = null,
    connected = false,
    busy = false,
    stopped = false;
  const configFile =
    process.env.CODING_KANBAN_HOST_CONFIG ||
    (["file", "vscode-remote"].includes(vscode.workspace.workspaceFile?.scheme)
      ? path.join(
          path.dirname(vscode.workspace.workspaceFile.fsPath),
          "codex-host-companion.json",
        )
      : null);
  if (!configFile)
    output.appendLine(
      "Unavailable: reopen the managed workspace from Coding Kanban",
    );
  const editorKey = vscode.workspace.workspaceFile?.fsPath;
  const post = (endpoint, body) =>
    request(config, endpoint, { cwd, instanceId, editorKey, ...body });
  const publish = async (document, range) => {
    if (!connected)
      throw new Error("看板宿主未连接，请在看板中重新连接 VS Code 上下文");
    await post("context", {
      context: await host.context(false, document, range),
    });
  };
  extensionContext.subscriptions.push(
    vscode.commands.registerCommand(
      "codingKanban.addEditorContext",
      async (uri, range) => {
        try {
          const document = uri?.scheme
            ? await vscode.workspace.openTextDocument(uri)
            : undefined;
          const editor = vscode.window.activeTextEditor;
          if (
            !range &&
            editor &&
            (!document ||
              document.uri.toString() === editor.document.uri.toString()) &&
            !editor.selection.isEmpty
          )
            range = editor.selection;
          await publish(document, range);
          vscode.window.showInformationMessage("已添加到目标会话草稿");
        } catch (error) {
          vscode.window.showWarningMessage(String(error.message));
        }
      },
    ),
  );
  output.appendLine(
    "Editor CodeLens setting=" +
      vscode.workspace.getConfiguration("editor").get("codeLens", true),
  );
  const lensChanges = new vscode.EventEmitter();
  extensionContext.subscriptions.push(
    lensChanges,
    vscode.workspace.onDidChangeTextDocument(() => lensChanges.fire()),
    vscode.window.onDidChangeActiveTextEditor(() => lensChanges.fire()),
  );
  extensionContext.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [{ scheme: "file" }, { scheme: "vscode-remote" }],
      {
        onDidChangeCodeLenses: lensChanges.event,
        provideCodeLenses(document) {
          if (
            !vscode.workspace
              .getConfiguration("codingKanban.host")
              .get("todoCodeLens", true)
          )
            return [];
          const lenses = createTodoCodeLenses(vscode, cwd, document);
          if (lenses.length)
            output.appendLine(
              "TODO CodeLens count=" +
                lenses.length +
                "; document scheme=" +
                document.uri.scheme,
            );
          return lenses;
        },
      },
    ),
  );
  const tick = async () => {
    if (busy || stopped || !configFile) return;
    busy = true;
    try {
      if (!connected) {
        config = JSON.parse(await fs.readFile(configFile, "utf8"));
        if (config.version !== 1 || !/^[a-f0-9]{64}$/.test(config.token))
          throw new Error("Invalid companion configuration");
        await post("connect", {
          capabilities: {
            context: true,
            openLocation: true,
            showDiff: true,
            todoCodeLens: vscode.workspace
              .getConfiguration("codingKanban.host")
              .get("todoCodeLens", true),
            lsp: vscode.workspace
              .getConfiguration("codingKanban.host")
              .get("lsp", false),
          },
        });
        connected = true;
        output.appendLine("Private gateway paired to this editor workspace");
      }
      const poll = await post("poll", {});
      for (const item of poll.commands || []) {
        try {
          await post("result", {
            requestId: item.id,
            result: await host.execute(item.command),
          });
        } catch (error) {
          await post("result", {
            requestId: item.id,
            error: String(error.message).slice(0, 1000),
          }).catch(() => {});
        }
      }
    } catch (error) {
      if (connected || !config)
        output.appendLine(
          "Private gateway unavailable; reconnect from Coding Kanban",
        );
      connected = false;
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, 1000);
  void tick();
  extensionContext.subscriptions.push({
    dispose: () => {
      stopped = true;
      clearInterval(timer);
    },
  });
  extensionContext.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("codingKanban.host")) connected = false;
    }),
  );
}
module.exports = { activate, createHost, createTodoCodeLenses, request };
