import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ respond: vi.fn() }));
vi.mock("@session/services/apiAdapt/codex", () => ({
  respondToRequestUserInput: api.respond,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
import {
  useRequestUserInputStore,
  type RequestUserInputRequest,
} from "../stores/useRequestUserInputStore";
import {
  resetRpcLifecycle,
  rpcKey,
  useRpcDeliveryStore,
} from "../stores/rpcLifecycle";
import { RequestUserInputItem } from "./RequestUserInputItem";
const request = (token = "original"): RequestUserInputRequest => ({
  requestId: 9,
  requestToken: token,
  threadId: "owner",
  turnId: "turn",
  itemId: "item",
  questions: [
    {
      id: "first",
      question: "Choose",
      isOther: true,
      options: [
        { label: "A (Recommended)", description: "Faster" },
        { label: "B" },
      ],
    },
    { id: "second", question: "Explain", options: null },
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
it("uses native Other and free-form placeholders independently of secret input", () => {
  useRequestUserInputStore.getState().addRequest(request());
  render(<RequestUserInputItem currentThreadId="owner" />);
  fireEvent.click(screen.getByRole("radio", { name: "userInput.custom" }));
  expect(
    screen.getByPlaceholderText("userInput.otherPlaceholder"),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: /userInput.nextQuestion/ }),
  );
  expect(
    screen.getByPlaceholderText("userInput.freeFormPlaceholder"),
  ).toBeTruthy();
  expect(api.respond).not.toHaveBeenCalled();
});
it("rejects a captured request after a new instance reuses its RPC id", async () => {
  const old = request();
  const store = useRequestUserInputStore.getState();
  store.addRequest(old);
  store.replaceRequests([request("replacement")]);
  await expect(
    store.respondToRequest(9, { answers: {} }, "owner", old),
  ).rejects.toThrow();
  expect(api.respond).not.toHaveBeenCalled();
});
it("advances a selected native option after 180ms without submitting, and retains custom draft", async () => {
  useRequestUserInputStore.getState().addRequest(request());
  render(<RequestUserInputItem currentThreadId="owner" />);
  fireEvent.click(screen.getByRole("radio", { name: "userInput.custom" }));
  fireEvent.change(screen.getByPlaceholderText("userInput.otherPlaceholder"), {
    target: { value: "remember custom" },
  });
  fireEvent.click(screen.getByRole("radio", { name: /A \(Recommended\)/ }));
  await waitFor(() => expect(screen.getByText("Explain")).toBeTruthy());
  expect(api.respond).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /userInput.previous/ }));
  fireEvent.click(screen.getByRole("radio", { name: "userInput.custom" }));
  expect(
    (
      screen.getByPlaceholderText(
        "userInput.otherPlaceholder",
      ) as HTMLTextAreaElement
    ).value,
  ).toBe("remember custom");
});
it("Escape only closes, CmdOrCtrl+Enter advances, and uncertainty locks all answer controls", async () => {
  const value = request();
  useRequestUserInputStore.getState().addRequest(value);
  render(<RequestUserInputItem currentThreadId="owner" />);
  const panel = screen.getByLabelText("userInput.title");
  fireEvent.keyDown(panel, { key: "Escape" });
  expect(screen.getByRole("button", { name: "userInput.expand" })).toBeTruthy();
  expect(api.respond).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "userInput.expand" }));
  fireEvent.click(screen.getByRole("radio", { name: /A \(Recommended\)/ }));
  fireEvent.keyDown(screen.getByLabelText("userInput.title"), {
    key: "Enter",
    ctrlKey: true,
  });
  expect(screen.getByText("Explain")).toBeTruthy();
  await act(async () =>
    useRpcDeliveryStore.setState({
      states: { [rpcKey(value)]: { phase: "uncertain", message: "unknown" } },
    }),
  );
  expect(
    (
      screen.getByPlaceholderText(
        "userInput.freeFormPlaceholder",
      ) as HTMLTextAreaElement
    ).disabled,
  ).toBe(true);
  expect(
    (
      screen.getByRole("button", {
        name: /userInput.submit/,
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
it("Enter on an already selected final option submits once, while IME Enter remains untouched", async () => {
  const value = request();
  value.questions = value.questions.slice(0, 1);
  useRequestUserInputStore.getState().addRequest(value);
  render(<RequestUserInputItem currentThreadId="owner" />);
  const option = screen.getByRole("radio", { name: /A \(Recommended\)/ });
  fireEvent.click(option);
  fireEvent.keyDown(option, { key: "Enter", isComposing: true });
  expect(api.respond).not.toHaveBeenCalled();
  fireEvent.keyDown(option, { key: "Enter" });
  await waitFor(() => expect(api.respond).toHaveBeenCalledTimes(1));
});

it("the native header browses unanswered questions without submitting or losing a custom draft", () => {
  const value = request();
  useRequestUserInputStore.getState().addRequest(value);
  render(<RequestUserInputItem currentThreadId="owner" />);
  const next = screen.getByRole("button", { name: "userInput.nextQuestion" });
  expect((next as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(next);
  expect(screen.getByText("Explain")).toBeTruthy();
  expect(screen.getByRole("status")).toBeTruthy();
  fireEvent.change(
    screen.getByPlaceholderText("userInput.freeFormPlaceholder"),
    {
      target: { value: "keep this unfinished answer" },
    },
  );
  expect(
    (
      screen.getByRole("button", {
        name: "userInput.nextQuestion",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "userInput.previous" }));
  fireEvent.click(
    screen.getByRole("button", { name: "userInput.nextQuestion" }),
  );
  expect(
    (
      screen.getByPlaceholderText(
        "userInput.freeFormPlaceholder",
      ) as HTMLTextAreaElement
    ).value,
  ).toBe("keep this unfinished answer");
  expect(api.respond).not.toHaveBeenCalled();
});
