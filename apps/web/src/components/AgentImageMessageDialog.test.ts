import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AgentImageMessageDialog,
  extractClipboardImage,
  validateCodexImageFile,
} from "./AgentImageMessageDialog.js";

describe("AgentImageMessageDialog", () => {
  it("renders an explicit destination, image preview, prompt, and retry-safe actions", () => {
    const image = new File([new Uint8Array([1, 2, 3])], "screen.png", {
      type: "image/png",
    });
    const markup = renderToStaticMarkup(
      createElement(AgentImageMessageDialog, {
        error: "发送失败，请重试",
        image,
        message: "请分析这张截图",
        onCancel: () => {},
        onChooseAnother: () => {},
        onMessageChange: () => {},
        onSend: () => {},
        previewUrl: "blob:screen-preview",
        sending: false,
        targetName: "实验终端",
      }),
    );

    assert.match(markup, /发送图片到 Codex/);
    assert.match(markup, /实验终端/);
    assert.match(markup, /src="blob:screen-preview"/);
    assert.match(markup, /alt="待发送图片预览"/);
    assert.match(markup, />重新选择</);
    assert.match(markup, />取消</);
    assert.match(markup, />发送到当前对话</);
    assert.match(markup, /发送失败，请重试/);
    assert.match(markup, /请分析这张截图/);
  });

  it("extracts the first clipboard image without treating copied text as an attachment", () => {
    const image = new File([new Uint8Array([1])], "clipboard.png", {
      type: "image/png",
    });
    const text = new File(["hello"], "note.txt", { type: "text/plain" });
    const transfer = {
      files: {
        0: text,
        1: image,
        length: 2,
        item(index: number) {
          return [text, image][index] ?? null;
        },
      },
    } as unknown as Pick<DataTransfer, "files">;

    assert.equal(extractClipboardImage(transfer), image);
    assert.equal(
      extractClipboardImage({
        files: {
          0: text,
          length: 1,
          item: () => text,
        },
      } as unknown as Pick<DataTransfer, "files">),
      null,
    );

    const itemOnlyTransfer = {
      files: {
        length: 0,
        item: () => null,
      },
      items: {
        0: {
          kind: "file",
          type: "image/png",
          getAsFile: () => image,
        },
        length: 1,
      },
    } as unknown as Pick<DataTransfer, "files" | "items">;
    assert.equal(extractClipboardImage(itemOnlyTransfer), image);
  });

  it("rejects unsupported or oversized files before upload", () => {
    assert.match(
      validateCodexImageFile(
        new File(["svg"], "diagram.svg", { type: "image/svg+xml" }),
      ) ?? "",
      /PNG、JPEG 或 WebP/,
    );
    assert.match(
      validateCodexImageFile(
        new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.png", {
          type: "image/png",
        }),
      ) ?? "",
      /10 MB/,
    );
  });
});
