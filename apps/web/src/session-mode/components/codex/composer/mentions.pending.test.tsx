import { StrictMode } from "react";
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useMentionItems } from "./mentions";
import { invalidatePluginCapabilities } from "@session/features/plugins/pluginInputs";
import { useWorkspaceStore } from "@session/stores/useWorkspaceStore";
import { usePairingStore } from "@session/stores/usePairingStore";
import { useCodexStore } from "@session/components/codex/stores/useCodexStore";
import { resetGoalCompletionScope } from "@session/services/goalCompletionAutoClear";
import { startCodexOperationScopeSync } from "@session/services/codexOperationScope";

const api = vi.hoisted(() => ({
  installed: vi.fn(),
  skills: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock("@session/services/apiAdapt/codex", () => ({
  pluginInstalled: api.installed,
}));
vi.mock("@session/services/codexService", () => ({
  codexService: { listSkills: api.skills },
}));
vi.mock("@session/lib/eventStream", () => ({
  openEventStream: () => {
    api.subscribe();
    return api.unsubscribe;
  },
}));

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const pluginResponse = (name: string) => ({
  marketplaces: [
    {
      plugins: [
        {
          id: `${name.replaceAll(" ", "-")}@market`,
          name: `${name.replaceAll(" ", "-")}@market`,
          installed: true,
          enabled: true,
          keywords: [],
          interface: { displayName: name },
        },
      ],
    },
  ],
});
const skillResponse = [
  {
    cwd: "/A",
    errors: [],
    skills: [
      {
        name: "fixture-skill",
        path: "/skills/fixture",
        enabled: true,
        description: "A fixture skill",
        interface: null,
      },
    ],
  },
];

// Each probe is a separate mounted consumer, like the menu, editor and slash
// selector. No hook or scope implementation is mocked in these cases.
function Probe({ name }: { name: string }) {
  const { items, refresh } = useMentionItems();
  return (
    <div>
      <output data-testid={name}>
        {items.map((item) => item.displayName).join(",")}
      </output>
      <button onClick={() => void refresh()}>Refresh {name}</button>
    </div>
  );
}

beforeEach(() => {
  api.installed.mockReset().mockResolvedValue({ marketplaces: [] });
  api.skills.mockReset().mockResolvedValue([]);
  api.subscribe.mockClear();
  api.unsubscribe.mockClear();
  useWorkspaceStore.setState({ cwd: "/A" });
  usePairingStore.setState({ desktops: [], selectedHost: null });
  useCodexStore.setState({
    accountNamespace: "pending-fixture",
    hasAccount: true,
  });
});
afterEach(() => vi.restoreAllMocks());

it.each([false, true])(
  "three mounted consumers share only the pending reads (StrictMode=%s)",
  async (strict) => {
    const plugins = deferred(),
      skills = deferred();
    api.installed.mockReturnValue(plugins.promise);
    api.skills.mockReturnValue(skills.promise);
    const probes = (
      <>
        <Probe name="menu" />
        <Probe name="editor" />
        <Probe name="slash" />
      </>
    );
    render(strict ? <StrictMode>{probes}</StrictMode> : probes);

    expect({
      plugins: api.installed.mock.calls,
      skills: api.skills.mock.calls,
    }).toEqual({
      plugins: [[{ cwds: ["/A"] }]],
      skills: [["/A"]],
    });
    await act(async () => {
      plugins.resolve(pluginResponse("Shared Plugin"));
      skills.resolve(skillResponse);
    });
    for (const name of ["menu", "editor", "slash"])
      expect(screen.getByTestId(name).textContent).toBe(
        "Shared Plugin,fixture-skill",
      );
  },
);

it("starts a fresh read after completion, sharing concurrent explicit refreshes", async () => {
  render(
    <>
      <Probe name="menu" />
      <Probe name="editor" />
    </>,
  );
  await act(async () => {});
  api.installed.mockClear();
  api.skills.mockClear();
  const next = deferred();
  api.installed.mockReturnValue(next.promise);
  act(() => {
    screen.getByText("Refresh menu").click();
    screen.getByText("Refresh editor").click();
  });
  expect(api.installed).toHaveBeenCalledTimes(1);
  expect(api.skills).toHaveBeenCalledTimes(1);
  await act(async () => next.resolve(pluginResponse("Fresh Plugin")));
  expect(screen.getByTestId("menu").textContent).toBe("Fresh Plugin");
  expect(screen.getByTestId("editor").textContent).toBe("Fresh Plugin");
});

it("releases a failed read for retry and preserves successful skill candidates", async () => {
  const failed = deferred();
  vi.spyOn(console, "error").mockImplementation(() => {});
  api.installed.mockReturnValue(failed.promise);
  api.skills.mockResolvedValue(skillResponse);
  render(
    <>
      <Probe name="menu" />
      <Probe name="editor" />
    </>,
  );
  await act(async () => failed.reject(new Error("fixture read failed")));
  expect(screen.getByTestId("editor").textContent).toBe("fixture-skill");
  api.installed.mockClear().mockResolvedValue(pluginResponse("Retried Plugin"));
  await act(async () => screen.getByText("Refresh editor").click());
  expect(api.installed).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("editor").textContent).toBe(
    "Retried Plugin,fixture-skill",
  );
});

it("keeps a pending workspace read separate and rejects its late response", async () => {
  const old = deferred();
  api.installed
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue(pluginResponse("Workspace B"));
  render(
    <>
      <Probe name="menu" />
      <Probe name="editor" />
    </>,
  );
  await act(async () => useWorkspaceStore.setState({ cwd: "/B" }));
  expect(api.installed.mock.calls).toEqual([
    [{ cwds: ["/A"] }],
    [{ cwds: ["/B"] }],
  ]);
  expect(api.skills.mock.calls).toEqual([["/A"], ["/B"]]);
  await act(async () => old.resolve(pluginResponse("Late Workspace A")));
  expect(screen.getByTestId("menu").textContent).toBe("Workspace B");
  expect(screen.getByTestId("editor").textContent).toBe("Workspace B");
});

it.each([
  "install revision",
  "catalog revision",
  "same-value account",
  "account",
  "endpoint",
  "token",
])("does not merge a pending read across a changed %s", async (change) => {
  // Synthetic pairing values exercise the real endpoint/header scope capture.
  usePairingStore.setState({
    desktops: [
      {
        name: "Fixture",
        host: "pending-fixture.invalid",
        port: 7420,
        token: "fixture-token-a",
      },
    ],
    selectedHost: "pending-fixture.invalid",
  });
  const old = deferred();
  api.installed
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue(pluginResponse("Current Scope"));
  render(
    <>
      <Probe name="menu" />
      <Probe name="editor" />
    </>,
  );
  await act(async () => {
    if (change === "install revision") invalidatePluginCapabilities();
    else if (change === "catalog revision")
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "kanban.session.plugins.changed.v1",
          newValue: "fixture-revision",
        }),
      );
    else if (change === "same-value account") resetGoalCompletionScope();
    else if (change === "account")
      useCodexStore.setState({ accountNamespace: "changed-fixture" });
    else
      usePairingStore.setState((state) => ({
        desktops: state.desktops.map((desktop) => ({
          ...desktop,
          ...(change === "endpoint"
            ? { port: desktop.port + 1 }
            : { token: "fixture-token-b" }),
        })),
      }));
  });
  expect(api.installed).toHaveBeenCalledTimes(2);
  expect(api.skills).toHaveBeenCalledTimes(2);
  await act(async () => old.resolve(pluginResponse("Revoked Scope")));
  expect(screen.getByTestId("menu").textContent).toBe("Current Scope");
  expect(screen.getByTestId("editor").textContent).toBe("Current Scope");
});

it("one consumer unmounting cannot cancel another consumer's pending read", async () => {
  const plugins = deferred();
  api.installed.mockReturnValue(plugins.promise);
  const view = render(
    <>
      <Probe key="menu" name="menu" />
      <Probe key="editor" name="editor" />
    </>,
  );
  view.rerender(<Probe key="editor" name="editor" />);
  await act(async () => plugins.resolve(pluginResponse("Remaining Consumer")));
  expect(api.installed).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("editor").textContent).toBe("Remaining Consumer");
});

it("adds no subscription after all consumers unmount and retains no completed candidate read", async () => {
  const plugins = deferred();
  api.installed.mockReturnValue(plugins.promise);
  const view = render(
    <>
      <Probe name="menu" />
      <Probe name="editor" />
    </>,
  );
  expect(api.subscribe).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(api.unsubscribe).toHaveBeenCalledTimes(1);
  await act(async () => plugins.resolve(pluginResponse("Unmounted Read")));
  expect(api.subscribe).toHaveBeenCalledTimes(1);
  api.installed.mockClear().mockResolvedValue({ marketplaces: [] });
  render(<Probe name="later" />);
  await act(async () => {});
  expect(api.installed).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId("later").textContent).toBe("");
});

it("bounds pending sharing across stalled workspace reads without cancelling them", async () => {
  const plugins = deferred();
  api.installed.mockReturnValue(plugins.promise);
  render(<Probe name="menu" />);
  for (let index = 0; index < 33; index++)
    act(() => useWorkspaceStore.setState({ cwd: `/pending-${index}` }));
  expect(api.installed).toHaveBeenCalledTimes(34);
  act(() => screen.getByText("Refresh menu").click());
  expect(api.installed).toHaveBeenCalledTimes(34);
  act(() => useWorkspaceStore.setState({ cwd: "/A" }));
  expect(api.installed).toHaveBeenCalledTimes(35);
  await act(async () => plugins.resolve(pluginResponse("Current Workspace")));
  expect(screen.getByTestId("menu").textContent).toBe("Current Workspace");
});

it.each(["same-value account", "runtime replacement"])(
  "does not reuse a pending read revoked by %s while all optional consumers were absent",
  async (change) => {
    const stopScopeSync = startCodexOperationScopeSync();
    const old = deferred();
    try {
      api.installed
        .mockReturnValueOnce(old.promise)
        .mockResolvedValue(pluginResponse("Current Scope"));
      const view = render(<Probe name="old" />);
      view.unmount();
      if (change === "same-value account") resetGoalCompletionScope();
      else window.dispatchEvent(new Event("session-runtime-restarted"));
      render(<Probe name="current" />);
      await act(async () => {});
      expect(api.installed).toHaveBeenCalledTimes(2);
      expect(api.skills).toHaveBeenCalledTimes(2);
      await act(async () => old.resolve(pluginResponse("Revoked Scope")));
      expect(screen.getByTestId("current").textContent).toBe("Current Scope");
    } finally {
      stopScopeSync();
    }
  },
);
