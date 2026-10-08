import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLayoutStore } from "@session/stores";
import { useAcpStore } from "@session/stores/useAcpStore";
import { useBotUiStore } from "@session/stores/useBotUiStore";

const createBot = vi.fn();

vi.mock("@session/services/apiAdapt/bots", () => ({
  listBots: vi.fn().mockResolvedValue([]),
  createBot: (...args: unknown[]) => createBot(...args),
  listBotSessions: vi.fn().mockResolvedValue([]),
  updateBot: vi.fn(),
  deleteBot: vi.fn(),
  parseBotList: () => [],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@session/components/bot/BotSettingsDialog", () => ({
  BotSettingsDialog: () => null,
}));
vi.mock("@session/components/bot", () => ({ SideBarBotPane: () => null }));
vi.mock("@session/components/bot/BotNotifications", () => ({
  BotNotifications: () => null,
}));
vi.mock("@session/components/pairing/DesktopDrawer", () => ({
  DesktopDrawer: () => null,
}));
vi.mock("@session/hooks", () => ({
  useTrafficLightConfig: () => ({ isMacos: false }),
}));
vi.mock("@session/hooks/runtime", () => ({ isPhone: () => false }));
vi.mock("@session/features/UpdateIndicator", () => ({
  UpdateIndicator: () => null,
}));
vi.mock("../common/SessionManagerDialog", () => ({
  SessionManagerDialog: () => null,
}));
vi.mock("./SideBarAgentPane", () => ({
  SideBarAgentHeader: () => null,
  SideBarAgentList: () => null,
  SideBarProjectActions: () => null,
}));
vi.mock("./SideBarPinnedList", () => ({ SideBarPinnedList: () => null }));
vi.mock("./UserInfo", () => ({ UserInfo: () => null }));
vi.mock("../common/NewAgentButton", () => ({ NewAgentButton: () => <button>新聊天</button> }));

import { SidebarProvider } from "@session/components/ui/sidebar";
import { AppSideBar } from "./AppSidebar";

beforeEach(() => {
  vi.clearAllMocks();
  useAcpStore.getState().reset();
  useBotUiStore.setState({
    bots: [],
    selectedBotId: null,
    connectionByBot: {},
    sessionByBot: {},
  });
});

describe("AppSideBar", () => {
  it("places projects before bots and separates the title from search", () => {
    render(<SidebarProvider><AppSideBar /></SidebarProvider>);
    expect(screen.queryByRole("heading", { name: "项目与会话" })).toBeNull();
    const projects = screen.getByRole("button", { name: "项目列表" });
    const bots = screen.getByRole("button", { name: /^机器人$/ });
    expect(screen.getByRole("button", { name: "搜索和管理会话" })).toBeTruthy();
    expect(projects.compareDocumentPosition(bots) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("button", { name: "收起项目列表" })).toBeNull();
  });
  it("opens the Bots view without creating a bot", () => {
    useLayoutStore.setState({ view: "agent" });
    render(
      <SidebarProvider>
        <AppSideBar />
      </SidebarProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^机器人$/ }));
    expect(useLayoutStore.getState().view).toBe("bot");
    expect(screen.getByRole("button", { name: "折叠机器人" })).toBeTruthy();
    expect(createBot).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "折叠机器人" }));
    expect(useLayoutStore.getState().view).toBe("bot");
  });

  it("clears the pane when a bot is created, so the previous bot does not appear to be it", async () => {
    createBot.mockImplementation(async (bot: Record<string, unknown>) => ({
      ...bot,
      title: null,
      agentId: "keke",
      provider: null,
      model: null,
      reasoningEffort: null,
      systemPrompt: null,
      trustLevel: "ask",
      approvedTools: "[]",
      mcpServers: "[]",
      pinned: false,
      archived: false,
      notificationsEnabled: true,
      unreadCount: 0,
      lastViewedAt: null,
      createdAt: "",
      updatedAt: new Date().toISOString(),
    }));
    // What the previously open bot left in the shared ACP store.
    useAcpStore
      .getState()
      .setEntries([{ id: "a", role: "agent", text: "bot1 was talking" }]);

    render(
      <SidebarProvider>
        <AppSideBar />
      </SidebarProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "newBot" }));

    await waitFor(() => expect(useAcpStore.getState().entries).toEqual([]));
    expect(useBotUiStore.getState().selectedBotId).toBeTruthy();
  });
});
