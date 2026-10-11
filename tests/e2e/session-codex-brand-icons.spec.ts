import { expect, test } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { setup } from "./session-composer-v2-fixture";
import { renderNativeMarkdownReference } from "./session-native-markdown-reference";
const reference = process.env.CODEX_NATIVE_REFERENCE_URL;
const targets = [
  ["box", "https://box.com/x"],
  ["dropbox", "https://dropbox.com/x"],
  ["google-calendar", "https://calendar.google.com/x"],
  ["google-drive", "https://docs.google.com/document/d/x"],
  ["drive", "https://drive.google.com/x"],
  ["sheets", "https://sheets.google.com/x"],
  ["slides", "https://slides.google.com/x"],
  ["figma", "https://figma.com/design/x/Example"],
  ["github", "https://github.com/a/b"],
  ["linear", "https://linear.app/x"],
  ["gmail", "https://mail.google.com/x"],
  ["notion", "https://app.notion.com/Example"],
  ["notion-so", "https://notion.so/Example"],
  ["recruiting-assistant", "https://recruiting.apps.openai.org/x"],
  ["salesforce", "https://force.com/x"],
  ["salesforce-com", "https://salesforce.com/x"],
  ["sharepoint", "https://sharepoint.com/x"],
  ["slack", "https://www.slack.com/x"],
  ["slack-api", "http://api.slack.com/x"],
  ["unknown", "https://example.com/x"],
];
test("audit native brand icon registry from actual Markdown DOM", async ({
  page,
}, info) => {
  test.skip(!reference, "Set native original reference URL");
  await page.route("https://t0.gstatic.com/**", (r) =>
    r.fulfill({ status: 404, body: "Isolated favicon failure" }),
  );
  const text = targets
    .map(([label, href]) => `[${label}](${href})`)
    .join("\n\n");
  await renderNativeMarkdownReference(page, reference!, text, "dark", 700);
  const icons = [];
  for (const [label, href] of targets) {
    const link = page.getByRole("link", { name: label, exact: true });
    await expect(link).toBeVisible();
    icons.push(
      await link.evaluate(
        (e, { label, href }) => ({
          label,
          href,
          text: e.textContent,
          svg: e.querySelector("svg")?.outerHTML,
          images: [...e.querySelectorAll("img")].map((i) =>
            i.getAttribute("src"),
          ),
        }),
        { label, href },
      ),
    );
  }
  await writeFile(
    info.outputPath("native-brand-registry.json"),
    JSON.stringify(icons, null, 2),
  );
  await page.screenshot({
    path: info.outputPath("native-brand-registry.png"),
    fullPage: true,
  });
  const urlLabels = targets
    .map(([, href]) => `[${href}](${href})`)
    .join("\n\n");
  await renderNativeMarkdownReference(page, reference!, urlLabels, "dark", 700);
  await writeFile(
    info.outputPath("native-url-labels.json"),
    JSON.stringify(
      await page.locator("#root a").evaluateAll((as) =>
        as.map((a) => ({
          href: a.getAttribute("href"),
          text: a.textContent,
        })),
      ),
      null,
      2,
    ),
  );
});

for (const width of [390, 700])
  for (const theme of ["dark", "light"])
    test(`all native brand icons match Markdown glyphs (${width}, ${theme})`, async ({
      page,
    }, info) => {
      test.skip(!reference, "Set native reference URL");
      test.setTimeout(90000);
      await page.setViewportSize({ width, height: 900 });
      const f = await setup(page, false),
        native = await page.context().newPage();
      try {
        const text = targets
          .map(([label, href]) => `[${label}](${href})`)
          .join("\n\n");
        f.fixture.threads[0].turns = [
          {
            id: "brand-registry",
            status: "completed",
            items: [
              {
                type: "agentMessage",
                id: "brands",
                text,
                phase: "final_answer",
              },
            ],
          },
        ] as never;
        await page.route("https://t0.gstatic.com/**", (r) =>
          r.fulfill({ status: 404, body: "Isolated favicon failure" }),
        );
        await native.route("https://t0.gstatic.com/**", (r) =>
          r.fulfill({ status: 404, body: "Isolated favicon failure" }),
        );
        await page.evaluate(
          (theme) =>
            localStorage.setItem(
              "kanban.session.theme-storage",
              JSON.stringify({
                version: 1,
                state: { theme, accent: "default" },
              }),
            ),
          theme,
        );
        await page.reload();
        await native.setViewportSize({ width, height: 900 });
        await renderNativeMarkdownReference(
          native,
          reference!,
          text,
          theme,
          width,
        );
        const results = [];
        for (const [label] of targets) {
          const product = page
              .locator(".codex-markdown")
              .getByRole("link", { name: label, exact: true }),
            original = native.getByRole("link", { name: label, exact: true });
          await expect(product).toBeVisible();
          await expect(original).toBeVisible();
          const glyph = (link: any) =>
            link.evaluate((e: Element) => {
              const svg = e.querySelector("svg")!,
                s = getComputedStyle(svg),
                r = svg.getBoundingClientRect();
              const copy = svg.cloneNode(true) as Element;
              copy.removeAttribute("class");
              copy.removeAttribute("xmlns");
              const tree = (node: Element): unknown => ({
                tag: node.tagName,
                attributes: [...node.attributes]
                  .map((a) => [a.name, a.value])
                  .sort((a, b) => a[0].localeCompare(b[0])),
                children: [...node.children].map(tree),
              });
              return {
                svg: tree(copy),
                width: r.width,
                height: r.height,
                color: s.color,
                images: e.querySelectorAll("img").length,
              };
            });
          const actual = await glyph(product),
            expected = await glyph(original);
          results.push({ label, actual, expected });
          await writeFile(
            info.outputPath("brand-glyphs.json"),
            JSON.stringify(results, null, 2),
          );
          expect(actual).toEqual(expected);
          await product.scrollIntoViewIfNeeded();
          await original.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: info.outputPath(`product-${label}.png`),
          });
          await native.screenshot({
            path: info.outputPath(`native-${label}.png`),
          });
        }
        expect(f.calls).toEqual([]);
        expect(f.errors).toEqual([]);
      } finally {
        await native.close();
        await f.close();
      }
    });
