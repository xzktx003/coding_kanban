# 原生插件宿主原型：部署与验收

2026-10-12。保存点为 `b56010697114946b32803c946452a6bf5c1c6f16`，annotated tag 为 `checkpoint/codex-replica-20261012`。保存点已通过完整 `pnpm check` 与 `pnpm test`，不代表此前尚未通过的浏览器性能和真实外部账号验收已经闭合。

实现位于独立分支 `codex/native-plugin-adaptation` 的 `packages/native-codex-host` 与 `packages/native-codex-adapter`。正式工作台、运行层、现有线程及登录目录未切换。云任务继续延期。

## 架构与可升级边界

官方 VSIX 通过真实 code-server CLI 安装；我们自己的伴随扩展另行打包、另行安装。伴随扩展只打开明确允许的测试线程 URI 和编辑器分栏，不注入或修改官方 Webview。只读控制器在独立进程连接显式指定的独立 IPC；不创建路由、不搜索默认 socket、不发送模型 turn、审批或中断。

官方包 `26.51002.51308` 的 VSIX SHA-256 为 `c5f534abf7dd1f08330483b5db6754001f2ad452096fc8e63925e597d3761373`，安装后的 `out/extension.js` 与分析原件均为 `bc0b44429768ea49c559c6a5524dcd710c500d6193f3bfe62c81cab75c18661c`。没有源码补丁。安装器还按官方 extensionPack 下载了官方音频扩展，未登录或启用语音。

官方插件可以独立更换安装包，但私有 IPC 仍须经过新版本核验。两个已允许的 manifest 版本具有相同宿主摘要，不能据此宣称跨版本升级验收通过。应用外层窗口组、公共输入和附件双向同步尚未接入。

## 真实浏览器与 IPC 结果

初次部署地址为 **HTTPS `https://10.30.0.24:18485/`**，绑定 `0.0.0.0`；它是独立原型，不是正式工作台的新模式。所有目录与端口由启动参数提供，机器信息不进入实现代码。凭证、证书私钥、运行记录与截图保持在忽略或私有目录。

- 原版 Codex 实际激活并启动自己的 App Server，伴随扩展通过正式 VSIX 安装后成功激活。
- 两个独立创建且没有 turn 的真实线程，通过 `vscode.openWith` 和 `chatgpt.conversationEditor` 分别出现在编辑器第 1、2 栏。两栏实际显示原版 Codex 登录页，已核对截图和内嵌文档；不是重绘界面或仅检查两个标签。
- 实际安装摘要验证、独立 IPC 初始化与两个线程的 owner discovery 均完成。未登录时原版返回没有 owner，控制器正确得到 `null`，pending 与 partial-frame 缓存均为零。**真实 owner 的 model settings 读取仍未验收**；没有通过伪造 owner、resume 或复制登录数据补齐结果。
- 记录了宿主自带的资源 404、贡献服务缺失和未登录 Statsig 警告。Webview Service Worker 需要可信 HTTPS：单独忽略页面证书错误不足以启动，测试浏览器仅对本原型证书的公钥摘要信任后才实际加载。普通试用浏览器也须信任测试证书，不能把测试浏览器参数当作普通用户已可用的证明。
- 密码保护的新实例完成真实匿名跳转、登录宿主、命令面板选中自身双面板命令和两个原版登录文档呈现。新 companion 的真实激活记录存在，安装后的官方宿主摘要再次保持不变；原生 IPC 对两线程仍返回没有 owner。此次浏览器控制台保留 10 项宿主错误，没有按零错误或完整登录/聊天验收交付。

code-server 是完整 IDE/终端宿主；独立 HOME、CODEX_HOME 和 TMPDIR 不等于操作系统文件访问隔离。启动器默认密码保护，密码文件只由启动器读取，不进入 argv、源码或公开运行记录；该流程已实测通过。**随后用户明确要求关闭试用站点密码**，当前同一 LAN 地址以显式 `--unsafe-no-auth` 配置重新部署，匿名请求经根路径的项目定位跳转进入 HTTP 200 工作台，不再跳转 `/login`；默认启动器行为未修改。新版部署引用正式工作台已有的开发 CA 证书；用户浏览器已信任该 CA 时无需额外证书配置。模型执行还须另外验收 Linux sandbox、登录、发送、附件、审批和终止流程。

一个 launcher 当前只配置一个固定 broker 端口，CLI `status/open` 始终面向首个占有该端口的 extension host，不能把它解释成“跟随当前浏览器”。端口已被持有时，新的 companion 保留本实例无参命令并明确禁用自身 HTTP，不接管监听者；其他绑定错误仍失败并清理自身资源。多浏览器/重连的本实例窗口控制使用命令 **Native Codex: Open Two Test Panels**；UI 中通过 Ctrl/Cmd+Shift+P 搜索该命令。两条线程均是此隔离 CLI home 创建的测试线程；入口不登录、发送、审批或中断。

## 验证范围

适配器独立临时 Unix socket 回归 29 项通过，覆盖原生 framing、版本、归属、超时、断线、初始化失败和默认 CLI home 隔离；独立审查通过。宿主、伴随扩展与 VSIX 打包 29 项回归通过，合计 **58 项**；最后重连修复经过同端口双 module 的真实 HTTP 测试以及更新安装后的实际浏览器命令/激活验收，整分支补充复审通过。两个无依赖 workspace importer 已纳入 lockfile，`pnpm install --lockfile-only --offline --ignore-scripts --frozen-lockfile` 通过。

浏览器初次观察中，外层 JS heap 约 364 MB、承载两个 Webview 的 renderer RSS 约 1142 MiB。这是单点开销观察，非稳定性结论；未做本原型 30 分钟 soak，外层 heap 不覆盖全部 iframe/worker 堆，也不能替代 renderer RSS。原插件在完整 VS Code 宿主内的成本须作为后续架构取舍的验收项。

## 复评

“保留原生插件，再由宿主与伴随扩展增加窗口能力”已得到原版双面板的实际证据，可以继续作为实施基础。当前交付是宿主和界面原型；尚不足以承诺把现有看板所有功能直接迁入，或做到任意升级后自动兼容。先让独立原型完成真实聊天，再接看板窗口组与公共输入；保持正式工作台可回退。
