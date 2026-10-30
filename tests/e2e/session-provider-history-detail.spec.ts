import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { installSessionUxFixture } from "./session-ux-fixture";
import { liveStream } from "./session-sse-fixture";

for (const provider of ["cc", "acp"] as const) for (const [width, revokeBeforeFirstGesture] of [[1440, false], [393, false], [1440, true], [393, true]] as const) {
  test(`${provider} cropped source is readonly, paged and released without losing the draft at ${width}px${revokeBeforeFirstGesture ? " when source changes before its first gesture" : ""}`, async ({ page, baseURL }, info) => {
    await page.setViewportSize({ width, height: 852 });
    const errors: string[] = [], detailReads: Array<{ path: string; body: any }> = [], pageReads: any[] = [];
    const originalCursor = "opaque-original-earlier-page";
    page.on("pageerror", error => errors.push(error.message));
    await installSessionUxFixture(page, 0);
    const sessionId = `detail-${provider}`;
    const sdk = [
      { type: "user", uuid: "original-question", session_id: sessionId, message: { role: "user", content: [{ type: "text", text: "Original SDK array question" }] } },
      { type: "assistant", uuid: "cropped-source", session_id: sessionId, truncated: true, historyDetail: { itemId: "cropped-source" }, message: { role: "assistant", content: [{ type: "text", text: "Bounded message preview" }] } },
    ];
    const entries = [{ id: "tool-source", role: "tool", toolCallId: "tool-original", title: "Original tool title", status: "completed", truncated: true, historyDetail: { itemId: "tool:tool-original" }, content: [{ type: "content", content: { type: "text", text: "Bounded tool preview" } }] }];
    await page.route(/\/api\/session\/api\/(?:cc\/session-messages|acp\/session)(?:\?.*)?$/, async route => {
      const metadataOnly = route.request().postDataJSON()?.metadataOnly === true;
      if (!metadataOnly) pageReads.push(route.request().postDataJSON());
      await route.fulfill({ json: { data: metadataOnly ? [] : provider === "cc" ? sdk : entries, nextCursor: null, revision: "stable-revision", truncated: true, projection: provider === "cc" ? "cc-messages" : "acp-entries", metadata: {} } });
    });
    await page.route(/\/api\/session\/api\/(?:cc\/session-message-detail|acp\/session-detail)$/, async route => {
      const body = route.request().postDataJSON();
      detailReads.push({ path: new URL(route.request().url()).pathname, body });
      await route.fulfill({ json: { text: body.offset === 0 ? "Exact original content · first part" : "Exact original content · final part", nextOffset: body.offset === 0 ? 40 : null, revision: "stable-revision", itemRevision: "a".repeat(64), format: "json" } });
    });
    const stream = await liveStream(page, baseURL!);
    try {
    await page.goto("/?mode=session", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".session-mode [contenteditable=true]").first()).toBeVisible();
    await page.evaluate(async ({ provider, sessionId, sdk, entries }) => {
      const load = (path: string) => import(performance.getEntriesByType("resource").findLast(entry => new URL(entry.name).pathname === path)?.name ?? path);
      const [{ useAgentSettingsStore }, { useAgentCenterStore }, { useCCStore }, { useAcpStore }, { fromSdkMessages }] = await Promise.all([
        load("/src/session-mode/stores/useAgentSettingsStore.ts"), load("/src/session-mode/stores/useAgentCenterStore.ts"),
        load("/src/session-mode/stores/cc/index.ts"), load("/src/session-mode/stores/useAcpStore.ts"), load("/src/session-mode/components/cc/utils/fromSdkMessages.ts"),
      ]);
      useAgentCenterStore.setState({ cards: provider === "cc" ? [{kind:"cc",id:sessionId,cwd:"/fixture/detail",preview:"Detail source"}] : [], currentAgentCardId:provider === "cc" ? sessionId:null,currentAgentCardKind:provider === "cc" ? "cc":null,cardsViewMode:"solo" });
      useAgentSettingsStore.setState({selectedAgent:provider === "cc" ? "cc":"codex"});
      if (provider === "cc") {
        useAcpStore.setState({active:false});
        const messages=fromSdkMessages(sdk,sessionId);
        useCCStore.setState({activeSessionId:sessionId,messages,sessionMessagesMap:{[sessionId]:messages},isLoading:false});
      } else useAcpStore.setState({active:true,agentId:"detail-fixture",connectionId:"detail-connection",sessionId,entries,running:false,connecting:false});
    }, { provider, sessionId, sdk, entries });
    if (provider === "cc") await expect(page.getByText("Original SDK array question", { exact: true })).toBeVisible();
    const trigger=page.getByRole("button",{name:"查看完整内容",exact:true});
    await expect(trigger).toBeVisible();
    expect(detailReads).toEqual([]);
    const confirmSource = page.getByRole("button", { name: "重新核对来源", exact: true });
    if (revokeBeforeFirstGesture) {
      // The old visible item came from a real accepted earlier page. Confirming
      // it later must retain that page locator instead of reading recent data.
      await page.evaluate(async ({ provider, sessionId, originalCursor }) => {
        const load = (path: string) => import(performance.getEntriesByType("resource").findLast(entry => new URL(entry.name).pathname === path)?.name ?? path);
        if (provider === "cc") {
          const { refreshClaudeHistory } = await load("/src/session-mode/services/followedSessionAuxSync.ts");
          await refreshClaudeHistory(sessionId, undefined, "interactive", originalCursor);
        } else {
          const { refreshAcpTranscript } = await load("/src/session-mode/services/acpTranscriptRead.ts");
          await refreshAcpTranscript({ agentId: "detail-fixture", connectionId: "detail-connection", sessionId }, undefined, "interactive", originalCursor);
        }
      }, { provider, sessionId, originalCursor });
    } else if (await confirmSource.isVisible()) {
      await confirmSource.click();
      await expect(trigger).toBeEnabled();
    }
    const editor=page.getByRole("textbox",{name:provider === "cc" ? "Message input":"ACP 消息输入",exact:true});
    await editor.fill("draft stays in this original owner");
    if (revokeBeforeFirstGesture) {
      // The protocol/account observer advances the operation lifetime before a
      // React row can disappear. Exercise that exact synchronous event gap.
      await page.evaluate(async () => {
        const path = "/src/session-mode/services/codexOperationScope.ts";
        const url = performance.getEntriesByType("resource").findLast(entry => new URL(entry.name).pathname === path)?.name ?? path;
        const { invalidateCodexOperationScope } = await import(url);
        invalidateCodexOperationScope();
        const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(element => element.textContent === "查看完整内容");
        if (!button) throw new Error("The original preview's trigger must still exist");
        button.click();
      });
      await expect(page.getByText("此预览的来源已变化，请重新加载会话后查看完整内容。", { exact: true })).toBeVisible();
      expect(detailReads).toEqual([]);
      await expect(page.getByRole("region", { name: "完整原始内容", exact: true })).toHaveCount(0);
      expect(await editor.evaluate(element => element instanceof HTMLTextAreaElement ? element.value : element.textContent)).toContain("draft stays in this original owner");
      // A new readonly page of this exact source is the only route back. The
      // account lifetime and item IDs stay unchanged while that confirmation
      // returns; an arbitrary rerender or object replacement is insufficient.
      await confirmSource.click();
      await expect(trigger).toBeEnabled();
      expect(pageReads.at(-1)?.cursor).toBe(originalCursor);
      await trigger.click();
      await expect(page.getByText("Exact original content · first part", { exact: true })).toBeVisible();
      expect(detailReads).toHaveLength(1);
      expect(detailReads[0].body).toMatchObject({ session_id: sessionId, item_id: provider === "cc" ? "cropped-source" : "tool:tool-original" });
      expect(errors).toEqual([]);
      await writeFile(info.outputPath("detail-requests.json"), JSON.stringify({ provider, width, revokeBeforeFirstGesture, detailReads, pageReads, originalCursor, oldSourceReadsBeforeConfirmation: 0, boundary: "Actual mounted earlier-page preview and production operation lifetime invalidation before the first gesture; zero detail reads before a fresh actual readonly original-cursor page confirms the same item. User confirmation permits exact-source detail without reloading the page." }, null, 2));
      return;
    }
    await trigger.click();
    await expect(page.getByText("Exact original content · first part",{exact:true})).toBeVisible();
    expect(detailReads).toHaveLength(1);
    expect(detailReads[0].body).toEqual({session_id:sessionId,item_id:provider === "cc" ? "cropped-source":"tool:tool-original",offset:0,limit:65536});
    await page.getByRole("button",{name:"下一部分",exact:true}).click();
    await expect(page.getByText("Exact original content · final part",{exact:true})).toBeVisible();
    await expect(page.getByText("Exact original content · first part",{exact:true})).toHaveCount(0);
    expect(detailReads).toHaveLength(2);
    expect(detailReads[1].body.offset).toBe(40);
    await page.getByRole("button",{name:"关闭完整内容",exact:true}).click();
    await expect(page.getByRole("region",{name:"完整原始内容",exact:true})).toHaveCount(0);
    expect(await editor.evaluate(element => element instanceof HTMLTextAreaElement ? element.value:element.textContent)).toContain("draft stays in this original owner");
    expect(errors).toEqual([]);
    await page.screenshot({path:info.outputPath("detail-closed-draft-preserved.png")});
    await writeFile(info.outputPath("detail-requests.json"),JSON.stringify({provider,width,detailReads,boundary:"Real browser UI and HTTP fetch to isolated routes; native history/detail proof is separate."},null,2));
    } finally { await stream.close(); }
  });
}
