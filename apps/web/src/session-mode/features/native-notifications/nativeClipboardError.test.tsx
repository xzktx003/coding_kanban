import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { NativeMessageCopy } from "../thread-workflows/NativeMessageCopy";
import { NativeCodeFence } from "../../components/codex/presentation/NativeCodeFence";
import { NativeMarkdownTable } from "../../components/codex/presentation/NativeMarkdownTable";
const mocks = vi.hoisted(() => ({ danger: vi.fn(), copy: vi.fn() }));
vi.mock("./service", () => ({ nativeNotifications: { danger: mocks.danger } }));
vi.mock("../../components/codex/presentation/nativeMarkdownClipboard", () => ({
  writeNativeMarkdownClipboard: mocks.copy,
}));
afterEach(() => vi.clearAllMocks());
for (const kind of ["message", "code", "table"] as const)
  it(`${kind} clipboard failure uses original localized global notice and stays uncopied`, async () => {
    mocks.copy.mockRejectedValue(new Error("isolated denial"));
    render(
      kind === "message" ? (
        <NativeMessageCopy text="response" kind="assistant" />
      ) : kind === "code" ? (
        <NativeCodeFence code="response" language="text" />
      ) : (
        <NativeMarkdownTable>
          <tbody>
            <tr>
              <td>response</td>
            </tr>
          </tbody>
        </NativeMarkdownTable>
      ),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name:
          kind === "message"
            ? "复制回复"
            : kind === "code"
              ? "复制代码"
              : "复制表格",
      }),
    );
    await waitFor(() =>
      expect(mocks.danger).toHaveBeenCalledExactlyOnceWith("无法复制到剪贴板", {
        id: "copy-to-clipboard-error",
        description: "内容未复制。请在 ChatGPT 处于焦点时重试",
      }),
    );
    expect(screen.queryByRole("button", { name: "已复制代码" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
