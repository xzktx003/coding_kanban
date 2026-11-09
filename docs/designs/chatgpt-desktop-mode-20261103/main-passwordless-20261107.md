# 8484 ChatGPT 模式免密码入口（2026-11-07）

按用户明确要求，主入口已去掉单独的工作台密码：打开 **https://10.30.0.26:8484/?mode=chatgpt&view=agent** 即进入原版 Codex。已打开旧页面时手动刷新一次；不需要私有登录链接或登录 Cookie。

网关使用显式 `accessMode: "workbench"` 和固定 HTTPS origin，仅监听 loopback。它沿用现有看板的访问边界，不另做用户身份认证；不读取、注入或签发旧口令。Host、Origin、Fetch Metadata 及 WSS 同源检查继续执行，原生账号、实例、预算和逐写授权保持。旧登录 GET 只跳回固定第四模式，HTTP 参数不能切换访问模式。独立候选默认仍为 token；机器配置保存在私有环境文件。

主入口同时采用已在同一宿主验证的冻结 v4 资源桥，包含冷启动队列修复和图片/分屏适配。继续使用原 8484 的 profile、账号、项目和持久历史，没有换成另一隔离候选的工作区。前端绑定 `0.0.0.0`，应用代理重读配置产生一次网页连接重连；原 native 管理器、容器和已有任务未重启，旧网关未停止。

## 实际验证

全新受信任 HTTPS 浏览器上下文初始 Cookie 为零，直接访问 8484，没有密码表单、登录步骤或候选登录 Cookie。原版项目按钮创建真实线程，原版 composer 单次发送消息；同线程追问不包含答案，真实 `gpt-6.1-sol` 两次正确回复。原生记录为 2 started / 2 completed，两次输入逐字核对原版补入的单个尾换行，无工具调用，无未知回执重发。

最终两条回复可见，唯一可见输入为空，唯一活动窗格精确绑定同一真实线程，Stop/Queue 已结束，没有 bridge 队列错误或原版错误页。原 SDK 的控制台 CSP 告警仍保留，不能将这两轮扩大为完整功能验收。

2026-11-08 再次以零 Cookie 的全新浏览器上下文直接访问主 8484：状态接口免 Cookie 返回 200，原 profile/代次保持，唯一原版输入框可见且无密码表单。本次仅核对访问入口，没有发送消息或操作已有任务；私有回执位于 `/data01/home/xing.hu/.cg-passwordless-verify-pdy2PK/receipt.json`。

- [脱敏收发与目标验证](artifacts/main-passwordless-20261107.json)
- 原生线程：`01a1b4a6-c393-7ba0-9b6e-41f53fcffaff`。
- 完整私有台账、截图、冻结清单、配置备份和首因：`/data01/home/xing.hu/.cg-main-open-tb7ua576`。

访问策略回归先复现旧实现缺少固定 origin 限制、旧登录路径未跳回，再验证免密码 HTTP/资源/WSS、跨站拒绝、互斥配置和默认 token 候选；候选类型检查通过。

```sh
# cwd: apps/server
node --import tsx --test chatgpt-candidate/candidate-workbench-access.test.ts chatgpt-candidate/candidate-auth.test.ts chatgpt-candidate/candidate-surface.test.ts
node node_modules/typescript/bin/tsc -p chatgpt-candidate/tsconfig.json --pretty false
```

文件工具的原生沙箱、共享 CLI 线程、SSH、云和其他桌面功能继续实施；当前保留项目 `Mac core delivery dofa_jut`。本次完成免密码入口和真实核心续聊，未宣称完整编程工作区交付。
