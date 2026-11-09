# 独立 LAN 候选的访问认证

2026-11-07 用户明确要求主 ChatGPT 模式取消密码。8484 已采用显式 `workbench` 访问模式；下文口令步骤仅适用于仍选择默认 `token` 的独立候选。主入口复现与验证见[免密码上线记录](main-passwordless-20261107.md)。

网关 CLI 设置 `CHATGPT_DESKTOP_ACCESS_MODE=workbench`，并配置 `CHATGPT_DESKTOP_WORKBENCH_ORIGIN` 为准确的 HTTPS origin（不带路径或尾斜杠），同时省略 `CHATGPT_DESKTOP_CANDIDATE_AUTH_TOKEN_FILE`。工厂对应 `accessMode: "workbench", workbenchOrigin`。此模式不签发登录 Cookie、不读口令；旧登录 GET 仅 303 返回固定第四模式。Host/HTTPS 转发协议、Origin 和 Fetch Metadata 仍核对，跨站和缺少 Origin 的 WSS 拒绝，原生账号、实例、消息预算和逐写授权不变。入口仍只监听 loopback，由现有看板代理；它本身不新增用户身份认证。

独立候选不继承正式 app 的认证 hook。仅检查 WebSocket Origin 不能作为用户认证；启用授权账号的候选必须使用 `apps/server/chatgpt-candidate/` 的显式入口。原有三个模式和默认启动流程不因此改变。

在 `apps/server` 目录执行 `node --import tsx chatgpt-candidate/chatgpt-desktop-candidate.ts`。必须提供 `CHATGPT_DESKTOP_CANDIDATE_PORT`、`CHATGPT_DESKTOP_PROFILE_FILE`、`CHATGPT_DESKTOP_CANDIDATE_AUTH_TOKEN_FILE`；监听仍只在 loopback，由独立 HTTPS Vite 前端转发。账号/profile 和 native 必须事先就绪，此入口不会启动、接管或重启它们。

认证口令文件是规范绝对路径、owned `0600`、非链接的普通文件，内容为随机 32 字节的小写 hex，可带一个尾换行。完整登录链接只保存在仓外私有文件，形式为 `https://<configured-host>:<configured-port>/__chatgpt-candidate-login#token=<private-token>`；不要把口令加入源码、启动参数或公开文档。

登录页立即清除 fragment，再以严格同源、最大 128 字节的 JSON POST 兑换 Cookie，固定 303 跳至第四模式。令牌不进入 HTTP URL、Referer 或 Vite 代理日志。链接在本次候选进程期内可重复使用；每次签发独立 `Secure; HttpOnly; SameSite=Strict` Cookie，最多 64 个会话、8 小时过期，不挤掉其他会话。候选网关退出后会话失效，重新打开私有链接即可；这不刷新 Codex 登录或重启 native。

认证在访问 profile/资源/Native WebSocket 前执行；普通 GET、模块和 WSS 均须有效 Cookie。原有 profile、Origin、scope、seq、消息预算和逐写授权继续执行。旧候选工厂仍仅适合既有隔离测试，不可据其默认无认证入口开放授权账号。

入口独立放在 `apps/server/chatgpt-candidate`，避免本轮落盘触发 `apps/server/src` 的正式网关 watcher；后续接入主启动流程前仍需完整产品验收。

最小检查：

```sh
# cwd: apps/server
node --import tsx --test chatgpt-candidate/candidate-auth.test.ts
node node_modules/typescript/bin/tsc -p chatgpt-candidate/tsconfig.json --pretty false
# cwd: repository root
node --test apps/web/chatgpt-candidate-proxy.test.mjs
```

隔离测试实际经过 Vite/Fastify，包含未认证 HTTP/WSS、固定跳转、跨 Origin、会话隔离/过期/上限及 `DEBUG=*` 的日志检查。真实 LAN 浏览器另确认匿名 API/资源 401、TLS 1.3、fragment 清除及安全 Cookie；真实 LAN WSS 在证书校验下返回 401。证据在本轮 Mac 私有验收根目录；这只证明访问门控，不证明原版桥接重开已稳定。
