# 设计草图检查记录

日期：2026-10-09。只检查设计产物，不是产品验收或原生像素一致性验收。

## 可访问产物

- 临时预览：`http://10.30.0.24:43831/review.html?reference=reference.png`。
- HTTP server 仅服务单独的 `review/` 目录，绑定 `0.0.0.0:43831`；没有暴露整个研究目录或仓库。
- Playwright 浏览器实际通过上述局域网 URL 访问；原图仅保存在忽略目录，不随 Git 发布。
- 正式 Session 服务没有重启，未发送、审批、停止、resume 或抢占任何真实 Agent。

## 已检查

| 项目 | 结果 |
|---|---|
| 桌面深色/浅色、手机截图 | 已生成并目视检查桌面深色、手机附件、手机答题面板；浅色与390px视口截图已生成 |
| 手机添加附件前/添加后/删除后 | 输入区高度分别124/124/124px |
| 左侧附件与删除入口 | 可展示、可删除，输入区不增高 |
| 答题自由输入草稿 | 切换草图状态后保留 |
| 主画面/审批/MCP/计划 | 均能切换显示 |
| 工具折叠 | hidden + inert，隐藏区不参加焦点交互 |
| 手机外层横向溢出 | 无；宽Diff独立滚动 |
| 浏览器运行错误 | pageerror为空 |
| Markdown文件内部链接/变更空白检查 | 通过 |

详细 JSON 和截图：本机 `.dev-runtime/session-render-alignment/review-smoke.json`、`desktop-dark.png`、`desktop-light.png`、`mobile-image.png`、`mobile-question.png` 等。

当前项目正文投影探针已再次执行，仍复现 delta交错→重复key/最终全文丢失；记录在 [evidence.md](evidence.md)。本轮没有修复产品代码，不能将此检查记录说成 bug 已转绿。

## 尚需实施后验收

真实插件主题/字体/DPR与页面状态冻结；同数据逐像素对照；完整产品红绿灯与前后端/Rust检查；真实编辑器桥、云账号任务；手机真实软键盘、上传与IME；多项目会话隔离、断线恢复和长历史性能。完整范围见 [plan.md](plan.md)。
