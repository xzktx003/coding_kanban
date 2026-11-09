// Owned network-none Chromium fixture; no native host, account or project.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { chromium } from "playwright";
const file =
  "/work/packages/chatgpt-desktop-host/src/browser-project-folder-picker.mjs";
const source = await readFile(file);
const html = `<!doctype html><meta charset=utf-8><body><button id=prior>Previous</button><script type=module>
import {createBrowserProjectFolderPicker} from "/picker.mjs";
let token={},life=null;const subscribers=new Set(),sent=[];
const scopeLease={getSnapshot:()=>token,isCurrent:t=>t===token,subscribe(fn){subscribers.add(fn);return ()=>subscribers.delete(fn)}};
const picker=createBrowserProjectFolderPicker({window,scopeLease,sendMessage:message=>{if(message.type==='kanban-project-folder-lifecycle'){life=message;queueMicrotask(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'kanban-project-folder-lifecycle-ack',sequence:message.sequence,epoch:message.epoch}})))}else sent.push(message)}});
window.fixture={sent,get epoch(){return life?.epoch},ready:false,message:data=>window.dispatchEvent(new MessageEvent("message",{data})),
 notify:()=>{for(const fn of subscribers)fn()},activate:()=>{token={};for(const fn of subscribers)fn()},dispose:()=>picker.dispose()};
picker.ready().then(()=>window.fixture.ready=true);
</script>`;
const server = createServer((req, res) => {
  if (req.url === "/")
    res.writeHead(200, { "content-type": "text/html" }).end(html);
  else if (req.url === "/picker.mjs")
    res.writeHead(200, { "content-type": "text/javascript" }).end(source);
  else res.writeHead(404).end();
});
await new Promise((resolve, reject) =>
  server.listen(0, "0.0.0.0", resolve).once("error", reject),
);
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath:
      "/playwright/chrome-headless-shell-linux64/chrome-headless-shell",
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
    ],
  });
  const page = await browser.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => !!window.fixture?.ready);
  const send = (data) =>
      page.evaluate((data) => window.fixture.message(data), data),
    messages = () => page.evaluate(() => window.fixture.sent);
  const id = randomUUID();
  const epoch = await page.evaluate(() => window.fixture.epoch);
  // A native modal can disable pointer events on body while it waits for the
  // folder selection. The owned picker must remain usable above that modal.
  await page.evaluate(() => { document.body.style.pointerEvents = 'none'; });
  await send({
    type: "kanban-project-folder-open",
    requestId: id,
    epoch,
    allowMultiple: false,
    roots: ["/tmp/home", "/work"],
  });
  await page.getByRole("dialog", { name: "选择项目文件夹" }).waitFor();
  await page.getByRole("button", { name: "/work", exact: true }).click({timeout:2000});
  assert.equal(await page.getByLabel("文件夹路径").inputValue(), "/work");
  await page.getByLabel("文件夹路径").fill("/work/project");
  await page.getByLabel("文件夹路径").press("Enter");
  await page.waitForFunction(() => window.fixture.sent.length === 1, null, {
    timeout: 2000,
  });
  assert.deepEqual((await messages())[0], {
    type: "kanban-project-folder-reply",
    requestId: id,
    epoch,
    action: "select",
    paths: ["/work/project"],
  });
  await send({ type: "kanban-project-folder-invalid", requestId: id, epoch });
  await page.getByLabel("文件夹路径").fill("/work/other");
  await page.getByRole("button", { name: "选择", exact: true }).click();
  assert.deepEqual((await messages())[1], {
    type: "kanban-project-folder-reply",
    requestId: id,
    epoch,
    action: "select",
    paths: ["/work/other"],
  });
  await send({ type: "kanban-project-folder-done", requestId: id, epoch });
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.evaluate(() => { document.body.style.pointerEvents = ''; });
  const multi = randomUUID();
  await send({
    type: "kanban-project-folder-open",
    requestId: multi,
    epoch,
    allowMultiple: true,
    roots: ["/work"],
  });
  await page.getByLabel("文件夹路径，每行一个").fill("/work/a\n/work/b");
  await page.getByRole("button", { name: "选择", exact: true }).click();
  assert.deepEqual((await messages())[2], {
    type: "kanban-project-folder-reply",
    requestId: multi,
    epoch,
    action: "select",
    paths: ["/work/a", "/work/b"],
  });
  await page.keyboard.press("Escape");
  assert.deepEqual((await messages())[3], {
    type: "kanban-project-folder-reply",
    requestId: multi,
    epoch,
    action: "cancel",
  });
  assert.equal(await page.getByRole("dialog").count(), 0);
  const last = randomUUID();
  await send({
    type: "kanban-project-folder-open",
    requestId: last,
    epoch,
    allowMultiple: false,
    roots: ["/work"],
  });
  await page.evaluate(() =>
    document.querySelector("[data-action=cancel]").click(),
  );
  assert.equal((await messages()).length, 4);
  await page.evaluate(() => window.fixture.notify());
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.deepEqual((await messages())[4], {
    type: "kanban-project-folder-reply",
    requestId: last,
    epoch,
    action: "cancel",
  });
  await page.evaluate(() => window.fixture.activate());
  const freshEpoch = await page.evaluate(() => window.fixture.epoch);
  assert.notEqual(freshEpoch, epoch);
  await send({
    type: "kanban-project-folder-open",
    requestId: randomUUID(),
    epoch: freshEpoch,
    allowMultiple: false,
    roots: ["/work"],
  });
  assert.equal(await page.getByRole("dialog").count(), 1);
  assert.deepEqual(errors, []);
  assert.equal(
    createHash("sha256")
      .update(await readFile(file))
      .digest("hex"),
    createHash("sha256").update(source).digest("hex"),
  );
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "native-open",
        "root-shortcut",
        "trusted-enter",
        "retry-after-invalid",
        "multiple",
        "escape-cancel",
        "untrusted",
        "scope-revocation",
        "fresh-activation",
      ],
      boundary:
        "owned isolated Chromium UI fixture; no native project or real account",
    }),
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
