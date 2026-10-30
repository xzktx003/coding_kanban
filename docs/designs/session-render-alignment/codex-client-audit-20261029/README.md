# Codex 本地客户端审计附录（2026-10-29）

主报告：[codex-client-full-audit-20261029.md](../codex-client-full-audit-20261029.md)。固定 VSIX `26.51007.21434`、项目 commit `f6699ba064059009529a50b0c126cbed4402f093`。只审计，不开发；原包未改。174功能对照、55场景行、26合并review组。完整资产索引与完整动态验收分开。

## 机器清单

| 文件 | 内容 / 数量 |
|---|---|
| [package-inventory.csv.gz](package-inventory.csv.gz) | 19,584文件路径/字节/SHA256/分类 |
| [module-inventory.csv.gz](module-inventory.csv.gz) | 14,764JS，hash/解析/节点/边计数 |
| [module-inventory-exports.csv.gz](module-inventory-exports.csv.gz) | 63,368 ES导出，名字/类型/UTF16起止；不含CommonJS helper语义恢复 |
| [import-edges.csv.gz](import-edges.csv.gz) | 全量47,038静态、10,295字面量动态、21表达式动态、239require语法边 |
| [import-edges-dynamic-expressions.csv](import-edges-dynamic-expressions.csv) | 全21处未解析表达式的原文/位置 |
| [protocol-candidates.ndjson.gz](protocol-candidates.ndjson.gz) | 全50,613次字面量候选出现位置 |
| [protocol-candidates.json.gz](protocol-candidates.json.gz) | 9,291不同值、次数/文件；仅318形似协议，候选不能当RPC全集 |
| [inventory-summary.json](inventory-summary.json) | 精确统计；去掉重复可达路径数组，完整分类/差集在details |
| [package-inventory-details.json.gz](package-inventory-details.json.gz) | 图标/共享分类、330非闭包模块、source-map/native头/全部动态表达式 |
| [host-manifest-inventory.json](host-manifest-inventory.json) | commands/config/keybinding/menus/views等完整manifest；packageSha256指package.json |
| [host-message-cases-classified.json](host-message-cases-classified.json) | 154case及fallthrough最终体，29实现/120no-op/5unsupported |
| [host-class-index.json](host-class-index.json) | 关键host类/方法UTF16范围 |
| [host-feature-rows.json](host-feature-rows.json) | H01–H24功能对照 |
| [host-runtime-status.json](host-runtime-status.json) | 已脱敏只读状态/已部署hash，未激活真实浏览器broker |
| [host-delivery-risk-repro.json](host-delivery-risk-repro.json) | fake连接验证投递分类，非真实重复任务 |
| [composer-source-index.json.gz](composer-source-index.json.gz) | 输入5个核心chunk函数/导入/导出/SHA索引 |
| [composer-locations.json.gz](composer-locations.json.gz) | 输入关键原包定位 |
| [transcript-inventory.json.gz](transcript-inventory.json.gz) | 正文54项及本地/原包追踪 |
| [transcript-anchors.json.gz](transcript-anchors.json.gz) | 原包50个精确锚、SHA、上下文 |
| [local-gap-audit.json](local-gap-audit.json) | LG01–LG42，含原包needle/偏移、本地行号 |
| [matrix-rows.json](matrix-rows.json) | M01–M55场景行；S/H/C/U证据层级 |
| [matrix-test-source-manifest.json](matrix-test-source-manifest.json) | 矩阵对应当前测试源码hash；存在不等于本轮执行 |
| [paired-e2e-summary.json](paired-e2e-summary.json) | 本轮9项实际结果、测试源码身份 |
| [paired-e2e-report.json](paired-e2e-report.json) | 本轮9项Playwright runner结构化记录 |
| [reference-hash-check.json](reference-hash-check.json) | 原组件参考资产11/11hash |
| [evidence-ledger.json](evidence-ledger.json) | 覆盖边界和REA Evidence IDs；语义分析partial |
| [artifact-manifest.json](artifact-manifest.json) | 本目录产物字节数/SHA256，不包括自身 |

## 解压与复核

压缩使用gzip、mtime=0，内容UTF-8；CSV和JSON各自保留明确字段，原包源码偏移都是**零基UTF-16 code unit**。例如：

```sh
gzip -dc docs/designs/session-render-alignment/codex-client-audit-20261029/module-inventory-exports.csv.gz | head
```

只解压数据不会执行插件或访问账号。复扫脚本[package-inventory.cjs](package-inventory.cjs)、[package-inventory-details.cjs](package-inventory-details.cjs)可从仓库根使用已有TypeScript依赖运行；输出默认是被git忽略的`.dev-runtime/codex-client-audit-20261029`，不会重写官方VSIX。

```sh
node --max-old-space-size=2048 --expose-gc docs/designs/session-render-alignment/codex-client-audit-20261029/package-inventory.cjs
node docs/designs/session-render-alignment/codex-client-audit-20261029/package-inventory-details.cjs
```

需要预先存在原包解压目录和TypeScript依赖。不要为此复制用户配置、连接默认IPC或启动正式任务。原包hash/manifest变化时停止沿用旧偏移。

## 动态证据边界

9项有限回放完成；追加4项队列像素测试因交互中断无完整报告，未计绿也未计产品失败。参考服务原PID已退出。原包全量资产盘点不等于所有运行分支逆向完成；REA语义图受堆/节点预算限制。原始52.9MB REA记录及截图/trace留在忽略的审计scratch，未复制官方源码大文件或凭证。

这组文档用于review，未修产品bug，因此未把审计候选登记为“已修复”，未改func_list/debug_list，也未提交git。
