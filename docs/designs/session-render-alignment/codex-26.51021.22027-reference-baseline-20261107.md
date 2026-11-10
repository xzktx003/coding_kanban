# Codex 官方基准 26.51021.22027 解压与钉定记录

记录会话模式 Codex 复刻的官方基准解压、版本校验与资产钉定（任务 t1 extract-pin）。
官方 VSIX **未被修改**；本流程不登录、不连接 CLI IPC、不启动 Codex，仅做只读解压与 serve-only 资产对照。

- 日期：2026-11-07
- 基准版本：`26.51021.22027`
- 来源 VSIX：`~/.chatgpt-kanban/native-codex-fix-20261106/openai.chatgpt-26.51021.22027@linux-x64.vsix`
  - 大小：`428,092,046` 字节；zip 校验通过（`Zip archive data, at least v2.0 to extract`）。
  - 源文件未被修改（解压为只读读取）。
- 解压目录：`third_party/openai.chatgpt-26.51021.22027-linux-x64/extension`
  - 该目录由 `third_party/` 的 `.gitignore` 覆盖，不随仓库提交，仅作为本地只读参考真值。

## 版本校验

- `extension/package.json` → `"version": "26.51021.22027"`，`"name": "chatgpt"`，`"publisher": "openai"`。
- `extension.vsixmanifest` → `<Identity Id="chatgpt" Version="26.51021.22027" .../>`。
- 两者与基准版本一致。

## 钉定的 webview 资产（SHA-256）

`tests/fixtures/codex-goal-reference/reference-assets.json` 钉定版本与 13 个 webview 入口/懒加载资源哈希，供
`scripts/codex-goal-reference-server.mjs` 在启动时校验。哈希以 `third_party/openai.chatgpt-26.51021.22027-linux-x64/extension/webview/assets/` 下实际字节为准。

| 资产 | SHA-256 |
| --- | --- |
| `index-e622cadf605d.js` | `ef5233634f9285750a5bdfcc4cc8be69a9517be2cbbb30a592d4d1d89e4b7d0f` |
| `rolldown-runtime-2d059c5e81f4.js` | `e0a79ad36c6ca1ffbc796c80aa5661803a9d1bc684e29d1587f48b4ba9a82714` |
| `app-initial-13f932cb2f13.js` | `9852ece5b9a25906b654fa8cccd77873105fe1b88556b141fc35dc4062511629` |
| `app-initial-b2ef6e3b3412.css` | `381a5c5a2e68a3c9fda84085e97f750f54686a88bb3170a9342ff2fcd86f3074` |
| `compiler-runtime-2015039f3c68.js` | `bd72069038e17f50754350a34e9f8b9aa5786aeda526c8cefe8b907fae6edcfd` |
| `message-bus-4113ba7287d7.js` | `9536ce9674179537acc6ecb09a74a01af08b203f4eb812851ea05182311c3ff0` |
| `vscode-theme-28ecab04055d.js` | `3132ef00ce249235f31e7d9752e0134e460052e6ad18dd9ae9ff20164d8b28f2` |
| `app-main-f01e5d0717a9.js` | `31cda074efa6ab51fc0067e8a289094e2c0ede0108867c9fc0eef42a35baed0d` |
| `core-cd4391224cfa.js` | `a8870fde1a7a377850b3d1e4b3612bfa56db1c172aa9561d44f70a018d5d0e84` |
| `zh-CN-bd2cd8444335.js` | `f0d7ed4cffc81493b463695ed66f9c6f8cc802d632757a98161264462a0f902a` |
| `thread-goal-side-panel-content-e914e774b73f.js` | `6f9aece4a1f16918770ac8225f156689008a276774e50da212b6a3e69185e152` |
| `composer-content-d9d771011586.js` | `83c9145993c797016c0325bf6d9872bd1a4ce0241c5847b0c905819e3f2a80a3` |
| `widget-renderer-76384741f919.js` | `f43499de899f81209668cac861ad27675b0f73a920baa9d30b84d2af4ef570d9` |

说明（相对旧钉定的 `26.1021.22027`）：`rolldown-runtime`、`app-initial-*.js/css`、`compiler-runtime`、
`message-bus`、`vscode-theme`、`core-cd4391224cfa.js`、`zh-CN-bd2cd8444335.js` 字节不变（内容寻址同名同哈希）；
变更的是入口与懒加载 chunk：`index-7e47869603c2.js → index-e622cadf605d.js`、
`app-main-765fabf054a6.js → app-main-f01e5d0717a9.js`、
`thread-goal-side-panel-content-f8f028e7a4a9.js → ...-e914e774b73f.js`、
`composer-content-8ab21f1a1982.js → composer-content-d9d771011586.js`、
`widget-renderer-9b2ea6ee3640.js → widget-renderer-76384741f919.js`。

## 迁移改动

1. `scripts/codex-goal-reference-server.mjs`：默认 `--extension` 路径改为
   `third_party/openai.chatgpt-26.51021.22027-linux-x64/extension`。
2. `tests/fixtures/codex-goal-reference/reference-assets.json`：版本与 13 个资产哈希迁到 `26.51021.22027`。
3. 应用入口夹具：
   - `native-app.html`：`src` 指向 `./assets/index-e622cadf605d.js`。
   - `native-app-reference.js`：`version` 与注释改到 `26.51021.22027`。
   - `native-thread-reference.js`：`goalPanel` 指向 `thread-goal-side-panel-content-e914e774b73f.js`，注释版本更新。
   - `native-composer-reference.js`：`composer-content-d9d771011586.js`，注释版本更新。
4. `scripts/codex-transcript-reference-server.test.mjs`：断言版本改为 `26.51021.22027`，并比对
   `index-e622cadf605d.js` 在磁盘与 HTTP 服务下的字节一致。

## assertion server 对“不同官方构建”的拒绝验证

`scripts/codex-goal-reference-server.mjs` 启动即校验 `manifest.version === expected.version` 且每个钉定资产哈希一致，
不一致直接 `throw`，不会静默测试过期组件。已实测三类拒绝：

- **版本不同的构建**（旧 `26.1021.22027`）：启动抛 `Error: Official reference package version changed; audit the fixture before upgrading`。
- **路径不存在**：`realpath` ENOENT 启动失败。
- **同版本但资产被篡改**（伪造 build，改一个资产字节）：启动抛 `Error: Official reference asset changed: rolldown-runtime-2d059c5e81f4.js`。

正确构建（默认路径，`--extension` 指向新解压目录）可正常启动并打印
`{"fixture":"codex-goal-reference","pid":...,"version":"26.51021.22027",...}`，
`/reference.json` 与 `reference-assets.json` 完全一致，`/assets/index-e622cadf605d.js` 的 HTTP 字节 SHA-256 与钉定值一致。

## 已知缺口（下游注意）

`tests/fixtures/codex-goal-reference/` 下目标/转录含硬编码符号的夹具仍是旧基线：
`native-goal-reference.js`、`native-transcript-reference.js`、`native-goal-draft-reference.js`、
`native-goal-completion-reference.js`（及 `native-goal.html` / `native-transcript.html`，
`function-index.json` / `installed-vs-reference-goal-functions.json`）导入
`app-initial-c4ebaa710049.js`、`app-initial-41ab338a184f.js`、`app-initial-fee819fe4f22.js`、
`zh-CN-b05cfd55c534.js`、`sites-end-resource-733bd1c6da06.js`、`app-initial-49150e6a0951.css` 等
`26.51007.21434` 资产，这些资产在 `26.51021.22027` 构建中不存在。

因此：
- **应用/线程/composer 参考**（`native-app.html` + 三个 discovery 模块）已在 `26.51021.22027` 钉定，供 t2/t3 复用。
- **目标/转录参考用例**（`session-goals-reference.spec.ts`、`session-goals-completion.spec.ts`、
  `session-goal-control-styles-reference.spec.ts`、`session-current-transcript-reference.ts`）依赖上述旧符号绑定，
  在切换到 `26.51021.22027` 基准前需要一次独立的符号重绑定审计（对 `26.51021.22027` 构建做 RE 取导）。
  这与原 README 的既有提示（“Symbol bindings are pinned to 26.51007.21434 and must be audited on upgrades”）一致。

## 其它

- `third_party/` 已 git-ignore，解压产物不入库。
- 官方 VSIX / 官方资产均未补丁；`codex-goal-reference-server.mjs` 只以 `--host 0.0.0.0` 提供只读 HTTP 资产，
  作为组件真值来源，不启动 Codex、不开 IPC、不读登录态。
