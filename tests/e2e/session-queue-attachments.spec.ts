import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { local, native, theme, queueAssetURLs } from "./session-queue-fixture";
const out = resolve(".dev-runtime/session-queue-attachments-20261027/browser");
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="24"><path fill="#d44" d="M0 0h24v24H0z"/><path fill="#48c" d="M24 0h24v24H24z"/></svg>';
const png =
  "iVBORw0KGgoAAAANSUhEUgAAADAAAAAYCAIAAAAzn+mLAAAAPklEQVR4nO3OQREAIBDDQEBbvWAFk3g5Cfn0mRWQyf7Jarh5lc6pVIocIg4Rh4hDxCHiEHGIOEQcIg4Rh8gAPSQCyK/0QQYAAAAASUVORK5CYII=";
const rasterPath = "/fixture/raster.png";
const image = `data:image/svg+xml,${encodeURIComponent(svg)}`;
const paths = [
  "/fixture/first.png",
  "/fixture/second.png",
  "/fixture/third.png",
];
const cases = [
  {
    id: "one-image",
    text: "",
    summary: "1 张图像",
    images: paths.slice(0, 1),
    nativeContext: { imageAttachments: [{ src: image }] },
  },
  {
    id: "three-images",
    text: "",
    summary: "3 张图像",
    images: paths,
    nativeContext: { imageAttachments: paths.map(() => ({ src: image })) },
  },
  {
    id: "text-images",
    text: "Check **these** images",
    summary: "Check these images",
    images: paths,
    nativeContext: { imageAttachments: paths.map(() => ({ src: image })) },
  },
  {
    id: "two-pastes",
    text: "",
    summary: "First captured preview (+其余 1 个粘贴文本附件)",
    contexts: [
      {
        id: "p1",
        kind: "paste",
        name: "paste",
        text: " First\n captured   preview ",
      },
      { id: "p2", kind: "paste", name: "paste2", text: "Second preview" },
    ],
    nativeContext: {
      pastedTextAttachments: [
        { preview: "First captured preview" },
        { preview: "Second preview" },
      ],
    },
  },
  {
    id: "two-selections",
    text: "",
    summary: "2 个已选文本片段",
    contexts: [
      {
        id: "q",
        kind: "quote",
        name: "quoted response",
        text: "answer selection",
      },
      {
        id: "f",
        kind: "file",
        name: "range.ts",
        text: "file selection",
        range: { start: 2, end: 4 },
      },
    ],
    nativeContext: {
      selectedTextAttachments: [
        { text: "answer selection" },
        {
          text: "file selection",
          source: {
            kind: "file",
            path: "range.ts",
            range: { start: 2, end: 4 },
          },
        },
      ],
    },
  },
  {
    id: "paste-image",
    text: "",
    summary: "First captured preview",
    images: paths.slice(0, 1),
    contexts: [
      {
        id: "p1",
        kind: "paste",
        name: "paste",
        text: "First captured preview",
      },
    ],
    nativeContext: {
      imageAttachments: [{ src: image }],
      pastedTextAttachments: [{ preview: "First captured preview" }],
    },
  },
  {
    id: "png-image",
    text: "Raster attachment",
    summary: "Raster attachment",
    images: [rasterPath],
    nativeContext: {
      imageAttachments: [{ src: `data:image/png;base64,${png}` }],
    },
  },
];
function assetPayload(path: string) {
  return path === rasterPath
    ? { contentType: "image/png", body: Buffer.from(png, "base64") }
    : { contentType: "image/svg+xml", body: Buffer.from(svg) };
}
/** Capture actual browser response bytes; both renderers must receive the same source. */
function networkAssets() {
  const pending: Promise<any>[] = [];
  return {
    async install(page: Page, label: string, requests?: string[]) {
      page.on("response", (response) => {
        const url = new URL(response.url());
        if (!url.pathname.endsWith("/api/filesystem/asset")) return;
        pending.push(
          (async () => {
            const body = await response.body();
            return {
              label,
              url: response.url(),
              path: url.searchParams.get("path")!,
              status: response.status(),
              contentType: response.headers()["content-type"],
              bytes: body.length,
              sha256: createHash("sha256").update(body).digest("hex"),
            };
          })().catch((error) => ({
            label,
            url: response.url(),
            error: String(error),
          })),
        );
      });
      await page.route("**/api/filesystem/asset?*", (route) => {
        const path = new URL(route.request().url()).searchParams.get("path")!;
        requests?.push(path);
        return route.fulfill(assetPayload(path));
      });
    },
    async verify(file: string) {
      const records = await Promise.all(pending);
      await writeFile(file, JSON.stringify(records, null, 2));
      expect(records.length).toBeGreaterThan(0);
      for (const record of records) {
        expect(record.error).toBeUndefined();
        const payload = assetPayload(record.path);
        expect(record.status).toBe(200);
        expect(record.contentType).toBe(payload.contentType);
        expect(record.bytes).toBe(payload.body.length);
        expect(record.sha256).toBe(
          createHash("sha256").update(payload.body).digest("hex"),
        );
      }
      return records;
    },
  };
}

for (const dark of [false, true])
  test(`${dark ? "dark" : "light"} queue attachment rows match actual native component`, async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    const reference = process.env.CODEX_GOAL_REFERENCE_URL;
    test.skip(!reference, "Official reference required");
    await mkdir(out, { recursive: true });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const diagnostic = new Map<any, { cdp: any; layers: any[] }>();
    const watch = async (target: any) => {
      const state = {
        cdp: await target.context().newCDPSession(target),
        layers: [] as any[],
      };
      diagnostic.set(target, state);
      state.cdp.on("LayerTree.layerTreeDidChange", (event: any) => {
        state.layers = event.layers ?? [];
      });
      await state.cdp.send("DOM.enable");
      await state.cdp.send("LayerTree.enable");
    };
    await watch(page);
    const fixture = await local(page);
    const sourceURLs = await queueAssetURLs(page, [...paths, rasterPath]);
    const requested: string[] = [];
    const assets = networkAssets();
    await assets.install(page, "local", requested);
    const official = await context.newPage();
    official.on("pageerror", (e) => errors.push(e.message));
    await watch(official);
    await native(official, reference!);
    await assets.install(official, "native");
    const records = [];
    const controls = [];
    for (let index = 0; index < 4; index++) {
      const control = await context.newPage();
      control.on("pageerror", (e) => errors.push(e.message));
      await native(control, reference!);
      await theme(control, dark);
      await assets.install(control, `native-control-${index}`);
      controls.push(control);
    }
    for (const original of cases) {
      // Keep the original data sources for the separate native-only control.
      // Pixel parity uses the exact same filesystem asset URL on every page.
      const value = {
        ...original,
        nativeContext: {
          ...original.nativeContext,
          ...(original.images?.length
            ? {
                imageAttachments: original.images.map((path) => ({
                  src: sourceURLs[path],
                })),
              }
            : {}),
        },
      };
      const shots: Buffer[] = [];
      const measurements: unknown[] = [];
      for (const [kind, target] of [
        ["native", official],
        ["local", page],
      ] as const) {
        await target.bringToFront();
        await theme(target, dark);

        await target.evaluate(
          (value) =>
            (window as any).renderQueue(value.text, true, undefined, value),
          value,
        );
        const group = target.getByRole("group", {
          name: /^(Preview queued message|预览排队消息) 1/,
        });
        await expect(group).toHaveCount(1);
        await expect(group).toHaveText(value.summary);
        const thumbnails = target.locator("#root img");
        await expect(thumbnails).toHaveCount(value.images?.length ? 1 : 0);
        if (value.images?.length) {
          await expect(thumbnails).toHaveJSProperty(
            "src",
            sourceURLs[value.images[0]],
          );
          await expect(thumbnails).toHaveAttribute("alt", "图像附件");
          await expect(thumbnails).toHaveAttribute("draggable", "false");
          await expect
            .poll(() =>
              thumbnails.evaluate(
                (e: HTMLImageElement) => e.complete && e.naturalWidth > 0,
              ),
            )
            .toBe(true);
          await thumbnails.evaluate((e: HTMLImageElement) => e.decode());
          await target.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve()),
                ),
              ),
          );
          await thumbnails.click();
          await expect(target.getByRole("dialog")).toHaveCount(0);
        }
        await target.mouse.move(0, 0);
        await target.evaluate(() =>
          (document.activeElement as HTMLElement)?.blur(),
        );
        await target.waitForTimeout(1000);
        measurements.push(
          await group.evaluate((element) => {
            const r = element.getBoundingClientRect();
            const img = document.querySelector<HTMLImageElement>("#root img");
            const rail = document
              .querySelector("[data-composer-rail-item]")!
              .getBoundingClientRect();
            const s = img && getComputedStyle(img);
            return {
              text: { x: r.x, y: r.y, width: r.width, height: r.height },
              row: {
                x: rail.x,
                y: rail.y,
                width: rail.width,
                height: rail.height,
              },
              image: img && {
                x: img.getBoundingClientRect().x,
                y: img.getBoundingClientRect().y,
                width: img.getBoundingClientRect().width,
                height: img.getBoundingClientRect().height,
                fit: s!.objectFit,
                border: s!.border,
                radius: s!.borderRadius,
              },
            };
          }),
        );
        const d = diagnostic.get(target)!;
        const layers = [];
        for (const layer of d.layers) {
          let node, reasons;
          try {
            node =
              layer.backendNodeId &&
              (await d.cdp.send("DOM.describeNode", {
                backendNodeId: layer.backendNodeId,
              }));
          } catch {}
          try {
            reasons = await d.cdp.send("LayerTree.compositingReasons", {
              layerId: layer.layerId,
            });
          } catch {}
          layers.push({ layer, node, reasons });
        }
        const chains = await target.evaluate(() =>
          ["#root img", "[data-composer-rail-item]"].map((selector) => {
            const nodes = [];
            for (
              let n = document.querySelector(selector);
              n;
              n = n.parentElement
            ) {
              const s = getComputedStyle(n);
              nodes.push({
                tag: n.tagName,
                cls: n.className,
                attributes: Object.fromEntries(
                  Array.from(n.attributes).map((a) => [a.name, a.value]),
                ),
                style: Object.fromEntries(
                  [
                    "background",
                    "border",
                    "border-radius",
                    "corner-shape",
                    "overflow",
                    "mask-image",
                    "opacity",
                    "transform",
                    "position",
                    "will-change",
                    "--composer-attachment-border-radius",
                    "--composer-corner-shape",
                  ].map((key) => [key, s.getPropertyValue(key)]),
                ),
              });
            }
            return { selector, nodes };
          }),
        );
        const mask = await target
          .locator(".session-queue-list, .vertical-scroll-fade-mask")
          .evaluate((e) => ({
            rect: e.getBoundingClientRect().toJSON(),
            style: Object.fromEntries(
              Array.from(getComputedStyle(e)).map((k) => [
                k,
                getComputedStyle(e).getPropertyValue(k),
              ]),
            ),
          }));
        const rail = await target
          .locator("[data-composer-rail]")
          .evaluate((e) => {
            const r = e.getBoundingClientRect();
            return {
              box: { x: r.x, y: r.y, width: r.width, height: r.height },
              element: Array.from(getComputedStyle(e)).map((k) => [
                k,
                getComputedStyle(e).getPropertyValue(k),
              ]),
              item: Array.from(
                getComputedStyle(e.querySelector("[data-composer-rail-item]")!),
              ).map((k) => [
                k,
                getComputedStyle(
                  e.querySelector("[data-composer-rail-item]")!,
                ).getPropertyValue(k),
              ]),
              style: Array.from(getComputedStyle(e, "::after")).map((k) => [
                k,
                getComputedStyle(e, "::after").getPropertyValue(k),
              ]),
            };
          });
        await writeFile(
          `${out}/${dark ? "dark" : "light"}-${value.id}-${kind}-layers.json`,
          JSON.stringify({ layers, chains, rail, mask }, null, 2),
        );
        shots.push(
          await target.screenshot({
            path: `${out}/${dark ? "dark" : "light"}-${value.id}-${kind}.png`,
          }),
        );
      }
      const samples = [shots[0]];
      for (let index = 0; index < controls.length; index++) {
        const control = controls[index];
        await control.bringToFront();
        // Fixed native lifecycle controls reach identical final props. No style
        // mutation, screenshot selection, or retries are used to change pixels.
        if (index > 0) {
          await control.evaluate(
            ({ value, index }) => {
              const seed =
                index === 1
                  ? { ...value, text: "Prior queued prompt" }
                  : index === 3
                    ? {
                        ...value,
                        nativeContext: {
                          ...value.nativeContext,
                          imageAttachments: [],
                        },
                      }
                    : value;
              (window as any).renderQueue(
                seed.text,
                true,
                index === 2 ? "Prior second queued prompt" : undefined,
                seed,
              );
            },
            { value, index },
          );
          await expect(
            control.getByRole("group", { name: /^Preview queued message/ }),
          ).toHaveCount(
            index === 2
              ? 2
              : index === 3 && !value.text.trim() && !value.contexts?.length
                ? 0
                : 1,
          );
          await control.waitForTimeout(250);
        }
        await control.evaluate(
          (value) =>
            (window as any).renderQueue(value.text, true, undefined, value),
          value,
        );
        await expect(
          control.getByRole("group", { name: /^Preview queued message/ }),
        ).toHaveCount(1);
        await expect(control.locator("#root img")).toHaveCount(
          value.images?.length ? 1 : 0,
        );
        const group = control.getByRole("group", {
          name: /^(Preview queued message|预览排队消息) 1/,
        });
        await expect(group).toHaveCount(1);
        await expect(group).toHaveText(value.summary);
        if (value.images?.length) {
          await expect(control.locator("#root img")).toHaveJSProperty(
            "src",
            sourceURLs[value.images[0]],
          );
          await expect
            .poll(() =>
              control
                .locator("#root img")
                .evaluate(
                  (e: HTMLImageElement) => e.complete && e.naturalWidth > 0,
                ),
            )
            .toBe(true);
          await control
            .locator("#root img")
            .evaluate((e: HTMLImageElement) => e.decode());
          await control.evaluate(
            () =>
              new Promise<void>((resolve) =>
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => resolve()),
                ),
              ),
          );
          await control.locator("#root img").click();
        }
        await control.mouse.move(0, 0);
        await control.waitForTimeout(1000);
        const controlGeometry = await group.boundingBox();
        expect(controlGeometry).toEqual(
          await official
            .getByRole("group", { name: /^Preview queued message 1/ })
            .boundingBox(),
        );
        expect(
          await control
            .locator(".vertical-scroll-fade-mask")
            .evaluate((e) => e.scrollTop),
        ).toBe(0);
        samples.push(
          await control.screenshot({
            path: `${out}/${dark ? "dark" : "light"}-${value.id}-native-control-${index}.png`,
          }),
        );
      }
      const variability = await page.evaluate(
        async ({ samples, actual }) => {
          const decode = async (data: string) => {
            const blob = await (
              await fetch(`data:image/png;base64,${data}`)
            ).blob();
            const bitmap = await createImageBitmap(blob);
            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
              ctx = canvas.getContext("2d")!;
            ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            return {
              width: canvas.width,
              data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
            };
          };
          const references = await Promise.all(samples.map(decode)),
            local = await decode(actual);
          const variance = [],
            outside = [];
          let different = 0;
          for (let offset = 0; offset < local.data.length; offset += 4) {
            const primary = references[0].data;
            const same = (data: Uint8ClampedArray) =>
              data[offset] === primary[offset] &&
              data[offset + 1] === primary[offset + 1] &&
              data[offset + 2] === primary[offset + 2] &&
              data[offset + 3] === primary[offset + 3];
            if (same(local.data) && references.every((ref) => same(ref.data)))
              continue;
            const colors = references.map((ref) =>
              Array.from(ref.data.slice(offset, offset + 4)).join(","),
            );
            const color = Array.from(local.data.slice(offset, offset + 4)).join(
              ",",
            );
            if (color !== colors[0]) different++;
            const observed = [...new Set(colors)];
            const point = {
              x: (offset / 4) % local.width,
              y: Math.floor(offset / 4 / local.width),
            };
            if (observed.length > 1) variance.push({ ...point, observed });
            if (!observed.includes(color))
              outside.push({ ...point, observed, actual: color });
          }
          return {
            sampleCount: references.length,
            comparedPixels: local.data.length / 4,
            differentFromPrimary: different,
            variance,
            outside,
          };
        },
        {
          samples: samples.map((s) => s.toString("base64")),
          actual: shots[1].toString("base64"),
        },
      );
      await writeFile(
        `${out}/${dark ? "dark" : "light"}-${value.id}-variance.json`,
        JSON.stringify(variability, null, 2),
      );
      records.push({
        id: value.id,
        measurements,
        bytesEqual: shots[0].equals(shots[1]),
        nativeVariancePixels: variability.variance.length,
        outsideObservedNativeColors: variability.outside.length,
      });
      await writeFile(
        `${out}/${dark ? "dark" : "light"}-comparison.json`,
        JSON.stringify(records, null, 2),
      );
      expect(measurements[1]).toEqual(measurements[0]);
      expect
        .soft(
          variability.outside,
          `${value.id}: each pixel must equal an observed native sample color`,
        )
        .toEqual([]);
    }
    expect(
      requested.every((path) => path === paths[0] || path === rasterPath),
    ).toBe(true);
    expect(await official.evaluate(() => (window as any).queueActions)).toEqual(
      [],
    );
    expect(
      fixture.calls.filter((c) =>
        /\/(turn\/(start|steer|interrupt)|followups\/(submit|change|stop))$/.test(
          c.path,
        ),
      ),
    ).toEqual([]);
    await assets.verify(
      `${out}/${dark ? "dark" : "light"}-network-responses.json`,
    );
    expect(errors).toEqual([]);
    for (const control of controls) {
      expect(
        await control.evaluate(() => (window as any).queueActions),
      ).toEqual([]);
      await control.close();
    }
    await official.close();
  });

test("queue details retain every captured attachment while collapsed desktop fetches only first image", async ({
  page,
}) => {
  const fixture = await local(page);
  const requested: string[] = [];
  await page.route("**/api/filesystem/asset?*", (route) => {
    requested.push(new URL(route.request().url()).searchParams.get("path")!);
    return route.fulfill(
      new URL(route.request().url()).searchParams.get("path") === rasterPath
        ? { contentType: "image/png", body: Buffer.from(png, "base64") }
        : { contentType: "image/svg+xml", body: svg },
    );
  });
  const captured = "First\n  captured " + "original body ".repeat(300);
  const contexts = [
    { id: "p1", kind: "paste", name: "Pasted capture", text: captured },
    {
      id: "f",
      kind: "file",
      name: "whole.ts",
      text: "entire file snapshot",
      path: "/fixture/whole.ts",
    },
    {
      id: "q",
      kind: "quote",
      name: "Response selection",
      text: "quoted response snapshot",
      sourceThreadId: "other",
    },
  ];
  await page.evaluate(
    ({ paths, contexts }) =>
      (window as any).renderQueue("", true, undefined, {
        images: paths,
        contexts,
      }),
    { paths, contexts },
  );
  await expect(page.locator("#root img")).toHaveCount(1);
  await expect.poll(() => requested).toEqual([paths[0]]);
  await page.getByRole("button", { name: "排队消息操作" }).click();
  await page.getByRole("menuitem", { name: "查看发送配置与上下文" }).click();
  const sheet = page.getByRole("dialog", { name: "待发送消息 · 1" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".session-followup-images img")).toHaveCount(3);
  for (const value of contexts) {
    await sheet.locator("summary").filter({ hasText: value.name }).click();
    await expect(
      sheet.locator("pre").filter({ hasText: value.text }),
    ).toHaveText(value.text, { useInnerText: false });
  }
  expect(new Set(requested)).toEqual(new Set(paths));
  expect(
    fixture.calls.filter((c) =>
      /\/(turn\/(start|steer|interrupt)|followups\/(submit|change|stop))$/.test(
        c.path,
      ),
    ),
  ).toEqual([]);
});

test("native data and network image sources are independent transport controls", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  const reference = process.env.CODEX_GOAL_REFERENCE_URL;
  test.skip(!reference, "Official reference required");
  await mkdir(out, { recursive: true });
  // Only URL resolution uses the local fixture; this control renders native UI.
  await local(page);
  const sourceURLs = await queueAssetURLs(page, [...paths, rasterPath]);
  const assets = networkAssets(),
    records = [],
    errors: string[] = [];
  for (const original of [cases[0], cases[cases.length - 1]]) {
    const pages: Page[] = [],
      shots: Buffer[] = [],
      geometry = [];
    const path = original.images![0],
      payload = assetPayload(path);
    const dataSource = original.nativeContext.imageAttachments![0].src;
    const dataBody = dataSource.startsWith("data:image/png;")
      ? Buffer.from(dataSource.split(",")[1], "base64")
      : Buffer.from(
          decodeURIComponent(dataSource.slice(dataSource.indexOf(",") + 1)),
        );
    expect(dataBody.equals(payload.body)).toBe(true);
    try {
      for (const mode of ["data", "network"] as const) {
        const target = await context.newPage();
        pages.push(target);
        target.on("pageerror", (e) => errors.push(e.message));
        await native(target, reference!);
        await theme(target, false);
        await assets.install(target, `${original.id}-${mode}`);
        const src = mode === "data" ? dataSource : sourceURLs[path];
        const value = {
          ...original,
          nativeContext: {
            ...original.nativeContext,
            imageAttachments: [{ src }],
          },
        };
        await target.evaluate(
          (value) =>
            (window as any).renderQueue(value.text, true, undefined, value),
          value,
        );
        const img = target.locator("#root img");
        await expect(img).toHaveCount(1);
        await expect(img).toHaveJSProperty("src", src);
        await img.evaluate((e: HTMLImageElement) => e.decode());
        await target.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve()),
              ),
            ),
        );
        await target.mouse.move(0, 0);
        await target.waitForTimeout(1000);
        geometry.push(await img.boundingBox());
        shots.push(
          await target.screenshot({
            path: `${out}/native-${mode}-${original.id}.png`,
          }),
        );
        expect(
          await target.evaluate(() => (window as any).queueActions),
        ).toEqual([]);
      }
      expect(geometry[1]).toEqual(geometry[0]);
      const differences = await pages[1].evaluate(
        async ({ images, rect }) => {
          const decoded = await Promise.all(
            images.map(async (image) => {
              const bitmap = await createImageBitmap(
                await (await fetch(`data:image/png;base64,${image}`)).blob(),
              );
              const canvas = new OffscreenCanvas(bitmap.width, bitmap.height),
                ctx = canvas.getContext("2d")!;
              ctx.drawImage(bitmap, 0, 0);
              bitmap.close();
              return {
                width: canvas.width,
                data: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
              };
            }),
          );
          const [a, b] = decoded;
          let fullPixels = 0;
          const imagePixels = [];
          for (let i = 0; i < a.data.length; i += 4) {
            if (
              a.data[i] === b.data[i] &&
              a.data[i + 1] === b.data[i + 1] &&
              a.data[i + 2] === b.data[i + 2] &&
              a.data[i + 3] === b.data[i + 3]
            )
              continue;
            fullPixels++;
            const x = (i / 4) % a.width,
              y = Math.floor(i / 4 / a.width);
            if (
              x >= rect!.x &&
              x < rect!.x + rect!.width &&
              y >= rect!.y &&
              y < rect!.y + rect!.height
            )
              imagePixels.push({
                x,
                y,
                data: Array.from(a.data.slice(i, i + 4)),
                network: Array.from(b.data.slice(i, i + 4)),
              });
          }
          return { fullPixels, imagePixels };
        },
        { images: shots.map((s) => s.toString("base64")), rect: geometry[0] },
      );
      // Loading transports can rasterize differently even inside the original
      // component. Record this control; never include it in the parity baseline.
      records.push({
        id: original.id,
        payloadSha256: createHash("sha256").update(payload.body).digest("hex"),
        geometry,
        bytesEqual: shots[0].equals(shots[1]),
        differences,
      });
    } finally {
      for (const target of pages) await target.close();
    }
  }
  await writeFile(
    `${out}/native-source-transport-control.json`,
    JSON.stringify(records, null, 2),
  );
  await assets.verify(`${out}/native-source-transport-responses.json`);
  expect(errors).toEqual([]);
});
