# 固定本地 VSIX 包的文件、模块与协议候选清单

本清单针对 `third_party/openai.chatgpt-26.51007.21434-linux-x64/extension`，插件版本 `26.51007.21434`，仓库 HEAD `f6699ba064059009529a50b0c126cbed4402f093`。统计生成时间为 `2026-10-29T07:36:57.656Z`。仅进行本地静态审计，没有启动插件、连接账号、调用模型、修改 VSIX 或实现产品功能。

## 覆盖与精确计数

| 项目 | 数目／结果 |
|---|---:|
| 包内普通文件 | 19,584 |
| 普通文件总字节 | 963,912,543 |
| 符号链接 | 0 |
| JS / MJS / CJS 模块 | 14,764 |
| JS / MJS / CJS 字节 | 381,364,587 |
| 其中 `webview/*.js` | 14,762 / 377,725,881 字节 |
| TypeScript JS parser 无语法诊断 | 14,764 / 14,764 |
| 有语法诊断文件 | 0 |
| 实际遍历 AST 节点 | 51,427,988 |
| ES 导出名称记录 | 63,368 |
| 静态 import 语句 | 47,038 |
| 带字面量的 dynamic import | 10,295 |
| 非字面量 dynamic import | 21 |
| `require` 调用候选 | 239 |
| 带 moduleSpecifier 的 reexport | 0 |
| 已解析到包内目标文件的 import 边 | 57,333 |
| 字面量相对路径找不到包内文件 | 0 |
| 协议／channel／discriminant 候选出现次数 | 50,613 |
| 候选不同字面量 | 9,291 |
| 其中满足明确协议前缀形状的不同字面量 | 318 |
| 包内 `.map` 文件 | 0 |
| 含 `sourceMappingURL=` 文本的 JS 文件 | 11,277 |

全部文件都有相对路径、字节数、SHA256、候选类别；全部 JS 都实际经过语法解析与 AST 遍历。这里的“解析通过”只表示 TypeScript parser 没有给出语法诊断，不代表类型检查、浏览器兼容性或功能验收。导出表记录 ES 语法中的名字及 UTF-16 源码范围，不把 minified CommonJS 导出 helper 还原成语义导出表。

确定性文件树摘要为 `2d333bbcc707f67eb4382feaa7d65c96bb4ac05c1c7e9d32dcc01ded738433af`。计算方式为按路径 codepoint 顺序排列，对每条 `JSON.stringify([path,bytes,sha256])+LF` 的 UTF-8 字节连续计算 SHA256。这是文件树元数据摘要，不能冒充 VSIX 压缩包的 SHA256。

## 真实加载边与入口

`webview/index.html` 的唯一 script 根为 `webview/assets/index-a81e152b9706.js`。实际 HTML 还预载 `rolldown-runtime-2d059c5e81f4.js` 和四个 `app-initial` 文件。由真实 AST import 边得到的静态闭包仅 6 个模块：

- `webview/assets/index-a81e152b9706.js`
- `webview/assets/rolldown-runtime-2d059c5e81f4.js`
- `webview/assets/app-initial-41ab338a184f.js`
- `webview/assets/app-initial-9133cd204fef.js`
- `webview/assets/app-initial-c4ebaa710049.js`
- `webview/assets/app-initial-fee819fe4f22.js`

允许沿字面量 dynamic import 继续遍历时，可能到达 14,434 个模块。剩余 330 个模块不在这个闭包中；这包括 extension-host 入口和很多由 Worker URL、配置地址或其他机制加载的模块，不能直接判为死代码。可达性同样不能证明某模块会在 VS Code 宿主实际执行：共享应用中的 lazy route、ChatGPT／desktop 分支可以静态可达而在该宿主被禁用。

239 个 `require` 候选中出现的字面量均为 `vscode` 或 Node 内建模块名称；它们不解析为包内相对文件。完整不同值见 `package-inventory-details.json`。没有相对字面量缺失，不等于已经解析了表达式导入、运行时注册表、Worker 和宿主注入的所有依赖。

## 分类及误读边界

原始文件类别是可复核的文件角色或名称候选：

| 原始类别 | 数目 |
|---|---:|
| application-or-shared-js | 14,452 |
| data-or-manifest | 788 |
| extension-host-entry | 1 |
| font | 67 |
| image | 3,559 |
| locale-name-candidate | 288 |
| native-runtime-or-resource | 45 |
| other-resource | 42 |
| shared-webview-bootstrap | 4 |
| stylesheet | 319 |
| worker-name-candidate | 19 |

额外的 import 图分类发现一个 `createLucideIcon` factory、1,535 个直接导入该 factory 且不大于 20,000 字节的模块，以及 1,737 个不大于 3,000 字节、只依赖这些模块和 rolldown runtime 的小 wrapper。这表明 14,764 个 JS 文件包含大量图标及拆包壳，不能当成同等数量的业务功能。

文件名候选额外命中 desktop 8 个、ChatGPT 112 个、vendor 模式 3,360 个、locale 模式 288 个。这些集合可以重叠，具体正则和全量路径保存在生成脚本及 details JSON；它们只供人工排查，不能作为“宿主支持／不支持”、云端能力、语言包完整性或未使用代码的结论。内嵌进大 bundle 的第三方逻辑不会被文件名分类完整识别。

45 个 `bin/` 文件中有 33 个 ELF 容器，其余 12 个是 JSON／license／NOTICE 等资源。这里提供容器头、路径、字节数和 SHA256，没有反编译原生实现，也没有把原生二进制内部逻辑纳入 JS 状态机覆盖率。

## 表达式动态导入的全部未解析位置

所有偏移均为原始 UTF-8 文本解码后的 **UTF-16 code unit** 起始位置，与 TypeScript AST `getStart()` 一致，适合 JavaScript `slice`；不是 UTF-8 字节偏移。完整结束偏移和上下文在 details JSON 中。

| 文件（均在 `webview/assets/`） | UTF-16 起始偏移 | 表达式 |
|---|---:|---|
| app-initial-c4ebaa710049.js | 2913859 | `import(e.module)` |
| dotnet-8b6430468111.js | 35029 | `import(t.resolvedUrl)` |
| dotnet-8b6430468111.js | 34502 | `import(t.resolvedUrl)` |
| dotnet-8b6430468111.js | 34317 | `import(e.resolvedUrl)` |
| dotnet-8b6430468111.js | 18168 | `import(t)` |
| editor-49b2c127081f.js | 4837 | `import(t)` |
| mapbox-gl-66adee0b43f2.js | 803363 | `import(n)` |
| mapbox-gl-csp-worker-138bf24e7cdb.js | 731292 | `import(t)` |
| pdf-66990bda81bf.js | 287031 | `import(this.workerSrc)` |
| pdf-bdee6a2dd2ae.js | 284985 | `import(this.workerSrc)` |
| pdf.worker.min-46513d3652c6.mjs | 138471 | `import(t)` |
| presentation-2d2953ab876c.js | 2377559 | `import(n)` |
| runtime.worker-430bca8c9c7b.js | 2552478 | `import(n)` |
| runtime.worker-4664ab3e891e.js | 2948735 | `import(n)` |
| runtime.worker-e6675a4130c8.js | 3028520 | `import(n)` |
| silero-vad-29e8bc5c1db0.js | 21929 | `import(e)` |
| walnut-reader-b304419bab89.js | 37900 | `import(t.resolvedUrl)` |
| walnut-reader-b304419bab89.js | 37373 | `import(t.resolvedUrl)` |
| walnut-reader-b304419bab89.js | 37188 | `import(e.resolvedUrl)` |
| walnut-reader-b304419bab89.js | 22937 | `import(t)` |
| workbook-ecec6e12f632.js | 1795111 | `import(n)` |

## 协议候选提取口径

逐 AST 字符串节点保留以下候选：`thread/`、`turn/`、`item/`、`account/` 等明确前缀的 RPC 形状，以及 switch case 的字符串，或对象字段 `type`、`method`、`event`、`channel`、`command`、`notification` 的字符串值；最长 512 字符。每一次出现均保存原始文件和 UTF-16 起止范围，而不是只保留去重后的关键词。

候选清单包含 UI 枚举、HTML 属性类型、第三方框架事件和共享应用的非 VS Code 分支，因此不能把 9,291 个值写成官方本地 RPC 数目。协议形状的 318 个值也必须结合 provider／发送调用／接收分发与宿主 capability 才能判断为真实本地通道。动态拼接、变量别名、解码、压缩表生成的 method／channel 不保证被这个字面量清单覆盖。此清单提供全量候选索引，语义可用性需要独立审计。

## 产物索引与复现

全部产物位于 `.dev-runtime/codex-client-audit-20261029/`：

| 文件 | 用途 |
|---|---|
| `package-inventory.json` / `.csv` | 全部 19,584 个文件的路径、字节数、SHA256、候选类别 |
| `module-inventory.json` / `.csv` | 全部 14,764 个 JS 的解析结果、导出名称及源码范围、节点数和边数 |
| `module-inventory-exports.csv` | 全部 63,368 条 ES 导出记录；file/name/local/type/UTF-16起止范围，63,358 named-export + 10 export-default |
| `import-edges-dynamic-expressions.csv` | 全部 21 条表达式动态 import 的原文、上下文及 UTF-16 起止范围 |
| `import-edges.json` / `.csv` | 真实 import／require 语法边、specifier、包内解析目标及 UTF-16 范围 |
| `protocol-candidates.ndjson` | 50,613 条候选出现位置，完整逐 occurrence 表 |
| `protocol-candidates.json` | 9,291 个不同值、次数、文件集合和首十处位置 |
| `package-inventory-summary.json` | 汇总、完整静态／literal dynamic 可达集合、未解析相对路径列表 |
| `package-inventory-details.json` | 文件树摘要、图标和名称候选路径、全部动态表达式位置、330 个非闭包模块、原生文件容器头 |
| `package-inventory.cjs` | 文件散列、顺序 AST 遍历、候选提取与图遍历脚本 |
| `package-inventory-details.cjs` | 额外分类和图差集脚本 |
| `package-inventory-run.log` | 本次扫描过程与汇总 |

使用已有 TypeScript parser（`typescript (existing workspace dependency)`），没有安装额外包。散列以单进程 1 MiB 缓冲逐文件读取，AST 顺序逐模块处理，未同时保留全包 AST。复现命令：

```sh
node --max-old-space-size=2048 --expose-gc .dev-runtime/codex-client-audit-20261029/package-inventory.cjs > .dev-runtime/codex-client-audit-20261029/package-inventory-run.log 2>&1
node .dev-runtime/codex-client-audit-20261029/package-inventory-details.cjs
```

结论边界：**完成的是固定包的全量文件散列、全量 JS 语法与显式模块边索引；这不等于全部本地逻辑已被语义还原，也不等于任何运行状态／手机刷新／多窗口／两秒加载已经得到验收。** 没有打包 source map，原 TypeScript／React 文件结构不能从 sourceMappingURL 注释直接恢复。
