import { SessionApiError } from "@session/services/apiAdapt/shared";
import { resetRpcLifecycle } from "../stores/rpcLifecycle";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ respond: vi.fn(), turnStart: vi.fn() }));
vi.mock("@session/services", () => ({
  respondToRequestUserInput: api.respond,
}));
vi.mock("@session/services/codexService", () => ({
  codexService: { turnStart: api.turnStart },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      ({
        "userInput.title": "问题",
        "userInput.next": "下一步",
        "userInput.previous": "上一题",
        "userInput.submit": "提交回答",
        "userInput.skip": "跳过此题",
        "userInput.custom": "自行填写",
        "userInput.collapse": "收起问题",
        "userInput.expand": "继续回答",
        "userInput.enterAnswer": "请输入你的回答",
        "userInput.progress": `${values?.current} / ${values?.total}`,
        "userInput.failed": "提交失败，请重试",
      })[key] ?? key,
  }),
}));
import { RequestUserInputItem } from "./RequestUserInputItem";
import {
  useRequestUserInputStore,
  type RequestUserInputRequest,
} from "../stores/useRequestUserInputStore";

const request = (
  id: number | string,
  threadId = "a",
): RequestUserInputRequest => ({
  requestId: id,
  threadId,
  turnId: "turn",
  itemId: "item",
  questions: [
    {
      id: "q1",
      header: "周末",
      question: "周末如何安排？",
      isOther: true,
      options: [
        { label: "出门逛逛", description: "探索附近" },
        { label: "在家休息" },
      ],
    },
    { id: "q2", header: "偏好", question: "还有什么要求？", options: null },
  ],
});
beforeEach(() => {
  resetRpcLifecycle();
  vi.clearAllMocks();
  api.respond.mockResolvedValue(undefined);
  useRequestUserInputStore.setState({
    pendingRequests: [],
    currentRequest: null,
    drafts: {},
  });
});
it("shows numbered options, navigates without submitting, then submits only the original request", async () => {
  useRequestUserInputStore.getState().addRequest(request(1));
  render(<RequestUserInputItem currentThreadId="a" />);
  expect(screen.queryByText("还有什么要求？")).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: /出门逛逛/ }));
  expect(api.respond).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "下一步" }));
  fireEvent.change(screen.getByPlaceholderText("请输入你的回答"), {
    target: { value: "安静一点" },
  });
  fireEvent.click(screen.getByRole("button", { name: "上一题" }));
  expect(
    screen
      .getByRole("radio", { name: /出门逛逛/ })
      .getAttribute("aria-checked"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "下一步" }));
  fireEvent.click(screen.getByRole("button", { name: "提交回答" }));
  await waitFor(() =>
    expect(api.respond).toHaveBeenCalledWith(1, {
      answers: { q1: { answers: ["出门逛逛"] }, q2: { answers: ["安静一点"] } },
    }),
  );
  expect(api.turnStart).not.toHaveBeenCalled();
});
it("keeps separate drafts across conversation switches and a collapsed form never answers", () => {
  useRequestUserInputStore.getState().addRequest(request(1));
  useRequestUserInputStore.getState().addRequest(request(2, "b"));
  const view = render(<RequestUserInputItem currentThreadId="a" />);
  fireEvent.click(screen.getByRole("radio", { name: /出门逛逛/ }));
  view.rerender(<RequestUserInputItem currentThreadId="b" />);
  expect(
    screen
      .getByRole("radio", { name: /出门逛逛/ })
      .getAttribute("aria-checked"),
  ).toBe("false");
  view.rerender(<RequestUserInputItem currentThreadId="a" />);
  expect(
    screen
      .getByRole("radio", { name: /出门逛逛/ })
      .getAttribute("aria-checked"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "收起问题" }));
  expect(screen.queryByText("周末如何安排？")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "继续回答" }));
  expect(api.respond).not.toHaveBeenCalled();
});
it("supports custom answers and explicit skips; confirmed rejection retains the draft for retry", async () => {
  api.respond.mockRejectedValueOnce(new SessionApiError("rejected", 400));
  useRequestUserInputStore.getState().addRequest(request("rpc"));
  render(<RequestUserInputItem currentThreadId="a" />);
  fireEvent.click(screen.getByRole("radio", { name: "自行填写" }));
  fireEvent.change(screen.getByPlaceholderText("请输入你的回答"), {
    target: { value: "散步" },
  });
  fireEvent.click(screen.getByRole("button", { name: "下一步" }));
  fireEvent.click(screen.getByRole("button", { name: "跳过此题" }));
  expect(api.respond).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "提交回答" }));
  await screen.findByRole("alert");
  expect(useRequestUserInputStore.getState().pendingRequests).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "提交回答" }));
  await waitFor(() =>
    expect(useRequestUserInputStore.getState().pendingRequests).toHaveLength(0),
  );
  expect(api.respond).toHaveBeenLastCalledWith("rpc", {
    answers: { q1: { answers: ["散步"] }, q2: { answers: [] } },
  });
});
it("deduplicates replay, distinguishes numeric ids from strings, and clears resolved requests only in the owning thread", () => {
  const store = useRequestUserInputStore.getState();
  act(() => {
    store.addRequest(request(1));
    store.addRequest(request(1));
    store.addRequest(request("1", "b"));
  });
  expect(useRequestUserInputStore.getState().pendingRequests).toHaveLength(2);
  act(() => store.resolveRequest("a", 1));
  expect(
    useRequestUserInputStore.getState().pendingRequests.map((r) => r.requestId),
  ).toEqual(["1"]);
});

it("an ambiguous network failure keeps answers and does not blindly repeat the RPC",async()=>{
  api.respond.mockRejectedValueOnce(new Error("offline"));
  useRequestUserInputStore.getState().addRequest(request("uncertain"));
  render(<RequestUserInputItem currentThreadId="a"/>);
  fireEvent.click(screen.getByRole("button",{name:"跳过此题"}));
  fireEvent.click(screen.getByRole("button",{name:"跳过此题"}));
  fireEvent.click(screen.getByRole("button",{name:"提交回答"}));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button",{name:"提交回答"}));
  await waitFor(()=>expect(api.respond).toHaveBeenCalledTimes(1));
  expect(useRequestUserInputStore.getState().pendingRequests).toHaveLength(1);
});
it("masks secret text and does not put answers into browser persistent storage", () => {
  const secret = request(1);
  secret.questions = [
    { id: "secret", question: "输入秘密", isSecret: true, options: null },
  ];
  useRequestUserInputStore.getState().addRequest(secret);
  render(<RequestUserInputItem currentThreadId="a" />);
  const input = screen.getByPlaceholderText("请输入你的回答");
  expect(input.getAttribute("type")).toBe("password");
  fireEvent.change(input, { target: { value: "only-in-memory-example" } });
  expect(JSON.stringify(localStorage)).not.toContain("only-in-memory-example");
  expect(JSON.stringify(sessionStorage)).not.toContain(
    "only-in-memory-example",
  );
});
it("uses arrow keys within a radio group without submitting and leaves no custom option when the protocol disallows it", () => {
  const fixed = request(1);
  fixed.questions[0].isOther = false;
  useRequestUserInputStore.getState().addRequest(fixed);
  render(<RequestUserInputItem currentThreadId="a" />);
  const first = screen.getByRole("radio", { name: /出门逛逛/ });
  fireEvent.keyDown(first, { key: "ArrowDown" });
  expect(
    screen
      .getByRole("radio", { name: "在家休息" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  expect(screen.queryByRole("radio", { name: "自行填写" })).toBeNull();
  expect(api.respond).not.toHaveBeenCalled();
});
