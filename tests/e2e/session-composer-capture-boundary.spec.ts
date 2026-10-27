import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./session-composer-v2-fixture";

for (const change of ["project", "model"] as const) {
  test(`new chat uses the captured ${change} and retains the unsent draft while context persistence is pending`, async ({ page }, info) => {
    const fixture = await setup(page, false);
    const posts: unknown[] = [];
    await page.route("**/api/codex/thread/start", async route => {
      posts.push(route.request().postDataJSON());
      await route.fulfill({ status:409, contentType:"application/json", body:JSON.stringify({error:"isolated unexpected thread creation"}) });
    });
    page.on("dialog", dialog => dialog.accept());
    try {
      await page.locator("[data-session-group]").getByRole("button",{name:"新聊天",exact:true}).click();
      const composer=page.locator(".session-native-composer");
      await expect(composer).not.toHaveAttribute("data-owner-thread",/.+/);
      const owner=await composer.getAttribute("data-draft-owner");
      const text=`captured ${change} draft must remain unsent`;
      await composer.locator("[contenteditable=true]").fill(text);
      await expect(composer.getByRole("button",{name:"发送消息",exact:true})).toBeEnabled();
      await page.evaluate(async () => {
        const load=(path:string)=>import(performance.getEntriesByType("resource").findLast(entry=>new URL(entry.name).pathname===path)?.name??path);
        const {contextDraftStorage}=await load("/src/session-mode/components/codex/composer/v2/draftStorage.ts");
        const {useWorkspaceStore}=await load("/src/session-mode/stores/useWorkspaceStore.ts");
        const {useConfigStore}=await load("/src/session-mode/components/codex/stores/useConfigStore.ts");
        const original=contextDraftStorage.save;
        const probe:any={entered:false,originalCwd:useWorkspaceStore.getState().cwd,originalModel:useConfigStore.getState().model,workspace:useWorkspaceStore,config:useConfigStore};
        probe.restore=()=>{contextDraftStorage.save=original;};
        contextDraftStorage.save=async (...args:any[])=>{
          const value=await original(...args);
          probe.entered=true;
          await new Promise<void>(resolve=>{probe.release=resolve;});
          return value;
        };
        (window as any).__captureBoundary=probe;
      });
      await composer.getByRole("button",{name:"发送消息",exact:true}).click();
      await expect.poll(()=>page.evaluate(()=>(window as any).__captureBoundary.entered)).toBe(true);
      await page.evaluate(change=>{
        const probe=(window as any).__captureBoundary;
        probe.restore();
        if(change==="project") probe.workspace.setState({cwd:"/fixture/different-project"});
        else probe.config.setState({model:"different-captured-model"});
        probe.release();
      },change);
      await expect(page.locator("[data-sonner-toast]")).toContainText(/项目或配置|isolated unexpected thread creation/);
      const evidence=await page.evaluate(async owner=>{
        const path="/src/session-mode/stores/useSessionDraftStore.ts";
        const {readDraft}=await import(performance.getEntriesByType("resource").findLast(entry=>new URL(entry.name).pathname===path)?.name??path);
        const probe=(window as any).__captureBoundary;
        return {originalCwd:probe.originalCwd,originalModel:probe.originalModel,draft:readDraft(owner)};
      },owner!);
      await writeFile(info.outputPath("capture-boundary.json"),JSON.stringify({change,posts,evidence},null,2));
      expect(posts).toHaveLength(1);
      expect(posts[0]).toMatchObject({cwd:evidence.originalCwd,model:evidence.originalModel || null});
      expect(evidence.draft.text).toBe(text);
      expect(fixture.calls).toEqual([]);
    } finally {
      await page.evaluate(()=>(window as any).__captureBoundary?.restore());
      await fixture.close();
    }
  });
}
