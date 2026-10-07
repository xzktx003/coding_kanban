import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Bot } from "@session/services/apiAdapt/bots";
import { BotWelcome } from "./BotWelcome";

describe("BotWelcome", () => {
  it("offers a direct first-bot action and disables it while creating", () => {
    const create = vi.fn();
    const { rerender } = render(
      <BotWelcome
        bots={[]}
        creating={false}
        onCreate={create}
        onSelect={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "创建你的第一个助手" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "创建助手" }));
    expect(create).toHaveBeenCalledOnce();
    rerender(
      <BotWelcome bots={[]} creating onCreate={create} onSelect={vi.fn()} />,
    );
    expect(
      screen
        .getByRole("button", { name: "正在创建…" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("opens an existing bot from its card and keeps new-bot creation available", () => {
    const bot = {
      id: "scout",
      name: "Scout",
      title: "Research",
      avatar: "🧭",
      color: "#2563eb",
    } as Bot;
    const select = vi.fn();
    render(
      <BotWelcome
        bots={[bot]}
        creating={false}
        onCreate={vi.fn()}
        onSelect={select}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "打开助手 Scout" }));
    expect(select).toHaveBeenCalledWith(bot);
    expect(screen.getByRole("button", { name: "新建助手" })).toBeTruthy();
  });
});
