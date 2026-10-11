# 原生插件适配前检查点

2026-10-12。用户授权统一提交当前全部非忽略改动并打 tag，然后尝试基于原生插件适配和开发。

检查点 tag：`checkpoint/codex-replica-20261012`。该 tag 保存此前复刻、自有运行层和接口调查成果，作为原生插件适配前的比较基线，不代表完整非云验收或正式发布。

提交范围包含当时已暂存、未暂存及新增的项目文件；被忽略的 `.env*`、本机 `.dev-runtime` 取证、第三方原包和运行数据保留在本地，不纳入提交。486个暂存文件的高置信度凭证模式扫描无命中，`.env`被忽略、`.env.example`可提交，暂存差异检查通过。

提交前 `pnpm check`、`pnpm test` 均退出0。Session前端426文件／1911项、终端534项、后端806项（另1项既有跳过）、运行层187项、脚本120项通过；生产构建保留原有较大chunk提示。日志为 `/tmp/codex-pre-native-checkpoint-check.log` 和 `/tmp/codex-pre-native-checkpoint-test.log`。这些检查不替代下面独立列出的长期／浏览器未闭合门槛。

既有未闭合项继续保留：标准30分钟内存长测RSS增长177.75MiB超过128MiB；WebKit长会话最近971ms超过500ms；完整宿主策略、真实OAuth MCP／Slack条件及正式运行层安全启用未完成。最新Chromium专项51项通过，不能替代这些独立门槛。

后续原生适配参考 [接口逆向与复评](native-extension-interfaces.md)：优先验证未修改官方插件、真实VS Code宿主、独立伴随扩展和版本化owner/follower IPC。在独立工作区和应用／编辑器／CLI数据目录开发，不重启正式服务，不接入现有IPC端点、不接管现有thread，不因启用新代码停止Agent。云任务开发保持暂停。

原版双面板、真实隔离IPC和升级回归的结果另行记录，不回写为本检查点已有成果。
