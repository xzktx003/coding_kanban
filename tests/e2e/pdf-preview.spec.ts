import { expect, test } from "@playwright/test";

test.use({ ignoreHTTPSErrors: true });

// A valid one-page PDF, with offsets computed instead of a checked-in binary.
function samplePdf() {
  const stream = "BT /F1 24 Tf 50 100 Td (Kanban PDF preview) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

for (const mobile of [false, true]) {
  test(`${mobile ? "mobile" : "desktop"} opens the complete PDF on file click`, async ({
    page,
  }) => {
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 },
    );
    const session = {
      id: "pdf-session",
      workspaceId: "default",
      sourceType: "local",
      agentKind: "codex",
      displayName: "PDF project",
      workingDirectory: "/workspace/pdf",
      connectionState: "online",
      interactionState: "idle",
      outputPreview: "ready",
    };
    const snapshot = {
      items: [session],
      activeAgentSessionId: session.id,
      updatedAt: new Date().toISOString(),
    };
    await page.route("**/api/agent-sessions", (route) =>
      route.fulfill({ json: snapshot }),
    );
    await page.routeWebSocket("**/ws/agent-sessions", (socket) =>
      socket.send(JSON.stringify({ type: "snapshot", payload: snapshot })),
    );
    await page.routeWebSocket("**/ws/terminal/**", () => {});
    const pdf = samplePdf();
    await page.route("**/api/fs/list", (route) =>
      route.fulfill({
        json: {
          path: "/workspace/pdf",
          entries: [
            {
              name: "report.PDF",
              path: "/workspace/pdf/report.PDF",
              type: "file",
              size: pdf.length,
              modifiedAt: "2026-09-07T00:00:00.000Z",
              owner: "test",
              permissions: "-rw-r--r--",
              isHidden: false,
            },
          ],
        },
      }),
    );
    await page.route("**/api/fs/preview", (route) =>
      route.fulfill({
        json: {
          path: "/workspace/pdf/report.PDF",
          encoding: "utf8",
          content: "%PDF-",
          truncated: true,
          size: pdf.length,
          mimeType: null,
        },
      }),
    );
    const downloads: unknown[] = [];
    await page.route("**/api/fs/download", (route) => {
      downloads.push(route.request().postDataJSON());
      return route.fulfill({
        contentType: "application/octet-stream",
        body: pdf,
      });
    });
    await page.goto(mobile ? "/?view=mobile" : "/");
    if (mobile) {
      await page
        .getByRole("navigation", { name: "手机端主导航" })
        .getByRole("button", { name: "项目/文件" })
        .click();
      await page.getByRole("button", { name: "浏览文件" }).click();
      await page
        .locator(".mobile-file-entry", { hasText: "report.PDF" })
        .click();
    } else {
      await page
        .locator(".grid-card", { hasText: session.displayName })
        .dblclick();
      await page.getByTestId("file-browser-toggle").click();
      await page.getByTestId("file-entry-report.PDF").click();
    }
    const frame = page.locator('iframe[title="PDF 预览"]');
    await expect(frame).toBeVisible();
    await expect(frame).toHaveAttribute("src", /^blob:/);
    expect(downloads[0]).toEqual({ path: "/workspace/pdf/report.PDF" });
    const content = await frame.evaluate(async (element) => {
      const blob = await (
        await fetch((element as HTMLIFrameElement).src)
      ).blob();
      return { type: blob.type, text: await blob.text() };
    });
    expect(content).toEqual({ type: "application/pdf", text: pdf });
    const previousUrl = await frame.getAttribute("src");
    if (!mobile) {
      await page.getByRole("button", { name: "全屏预览", exact: true }).click();
      await expect(
        page.locator(".file-browser-fullscreen-preview iframe"),
      ).toBeVisible();
      await page.getByRole("button", { name: "退出全屏预览" }).click();
      await expect(frame).toBeVisible();
    } else {
      await page.getByRole("button", { name: "返回文件", exact: true }).click();
      await expect(frame).toHaveCount(0);
    }
    expect(
      await page.evaluate(async (url) => {
        try {
          await fetch(url!);
          return false;
        } catch {
          return true;
        }
      }, previousUrl),
    ).toBe(true);
  });
}
