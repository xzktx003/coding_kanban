import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { respondToMcpElicitation } from "@session/services";
import { SessionApiError } from "@session/services/apiAdapt/shared";
import { ElicitationItem } from "./ElicitationItem";
import {
  elicitationFields,
  initialElicitationValues,
  validateElicitationValues,
} from "../stores/elicitationFields";
import {
  type ElicitationRequest,
  useElicitationStore,
} from "../stores/useElicitationStore";
import {
  resetRpcLifecycle,
  rpcKey,
  useRpcDeliveryStore,
} from "../stores/rpcLifecycle";

vi.mock("@session/services", () => ({ respondToMcpElicitation: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const send = vi.mocked(respondToMcpElicitation);
const upload = vi.hoisted(() => vi.fn());
vi.mock("@session/browser-dialog", () => ({ uploadBrowserFile: upload }));
const imageData =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZ0AAAAASUVORK5CYII=";
const respond = useElicitationStore.getState().respond;
function request(extra: Partial<ElicitationRequest> = {}): ElicitationRequest {
  return {
    requestId: 31,
    threadId: "owner",
    turnId: "turn",
    serverName: "Research tools",
    mode: "form",
    message: "Provide search preferences",
    _meta: null,
    requestedSchema: {
      type: "object",
      properties: { query: { type: "string", title: "Query", minLength: 1 } },
      required: ["query"],
    },
    ...extra,
  } as ElicitationRequest;
}

it("supports the actual enabled legacy image picker and submits its exact native item id", async () => {
  const value = request({
    mode: "openai/form",
    requestedSchema: {
      type: "object",
      properties: {
        image: {
          type: "openai/imagePicker",
          title: "Choose image",
          items: [{ id: "template-id", title: "Template", image: imageData }],
        },
      },
      required: ["image"],
    },
  } as Partial<ElicitationRequest>);
  seed(value);
  render(<ElicitationItem currentThreadId="owner" />);
  expect(screen.queryByText("elicitation.unsupportedField")).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "Template" }));
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "common.submit" }));
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      31,
      "accept",
      { image: "template-id" },
      null,
      expect.objectContaining({ threadId: "owner", turnId: "turn" }),
    ),
  );
  expect(
    validateElicitationValues(elicitationFields(value), { image: "another-id" })
      .content,
  ).toBeNull();
});

it("uploads a selected browser file only when native file schema allows it and submits encoded file URI", async () => {
  upload.mockResolvedValue("/tmp/session-uploads/with space.png");
  const value = request({
    mode: "openai/form",
    requestedSchema: {
      type: "object",
      properties: {
        image: {
          type: "openai/imagePicker",
          title: "Choose image",
          items: [],
          file: { accept: ["image/png"], title: "Local image" },
        },
      },
      required: ["image"],
    },
  } as Partial<ElicitationRequest>);
  const pick = vi
    .fn()
    .mockResolvedValue(new File(["png"], "local.png", { type: "image/png" }));
  seed(value);
  render(<ElicitationItem currentThreadId="owner" onPickFile={pick} />);
  fireEvent.click(screen.getByRole("button", { name: "Local image" }));
  await waitFor(() =>
    expect(pick).toHaveBeenCalledWith(
      value,
      expect.objectContaining({ id: "image" }),
    ),
  );
  await waitFor(() => expect(screen.getByText("with space.png")).toBeTruthy());
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "common.submit" }));
  await waitFor(() =>
    expect(send.mock.calls[0]?.[2]).toEqual({
      image: "file:///tmp/session-uploads/with%20space.png",
    }),
  );
});

it("a late picker upload cannot update the new request instance or submit anything", async () => {
  let resolve!: (value: string) => void;
  upload.mockImplementation(
    () =>
      new Promise<string>((r) => {
        resolve = r;
      }),
  );
  const value = request({
    requestToken: "old",
    mode: "openai/form",
    requestedSchema: {
      type: "object",
      properties: {
        image: {
          type: "openai/imagePicker",
          title: "Choose image",
          items: [],
          file: { title: "Local image" },
        },
      },
      required: ["image"],
    },
  } as Partial<ElicitationRequest>);
  seed(value);
  render(
    <ElicitationItem
      currentThreadId="owner"
      onPickFile={async () => new File(["png"], "local.png")}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Local image" }));
  await waitFor(() => expect(upload).toHaveBeenCalled());
  const next = { ...value, requestToken: "new" };
  await act(async () =>
    useElicitationStore.setState({ pendingRequests: [next] }),
  );
  await act(async () => resolve("/tmp/old-upload.png"));
  expect(
    useElicitationStore.getState().drafts[rpcKey(next)]?.values.image,
  ).toBeUndefined();
  expect(send).not.toHaveBeenCalled();
});
it("the ordinary native MCP callsite keeps schema file picking hidden without an explicit caller capability", () => {
  seed(
    request({
      mode: "openai/form",
      requestedSchema: {
        type: "object",
        properties: {
          image: {
            type: "openai/imagePicker",
            title: "Image",
            items: [{ id: "template", title: "Template", image: imageData }],
            file: { title: "Local image" },
          },
        },
      },
    } as Partial<ElicitationRequest>),
  );
  render(<ElicitationItem currentThreadId="owner" />);
  expect(screen.getByRole("radio", { name: "Template" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Local image" })).toBeNull();
});
it("uses the first actual image dimensions for the native portrait gallery without altering its selection", () => {
  seed(
    request({
      mode: "openai/form",
      requestedSchema: {
        type: "object",
        properties: {
          image: {
            type: "openai/imagePicker",
            items: [{ id: "portrait", title: "Portrait", image: imageData }],
          },
        },
      },
    } as Partial<ElicitationRequest>),
  );
  render(<ElicitationItem currentThreadId="owner" />);
  const img = document.querySelector("img")!;
  Object.defineProperties(img, {
    naturalWidth: { value: 80 },
    naturalHeight: { value: 100 },
  });
  fireEvent.load(img);
  expect(
    document
      .querySelector(".codex-elicitation__image-picker")
      ?.getAttribute("data-portrait"),
  ).toBe("true");
  expect(
    (screen.getByRole("radio", { name: "Portrait" }) as HTMLInputElement)
      .checked,
  ).toBe(false);
  expect(send).not.toHaveBeenCalled();
});
function seed(...requests: ElicitationRequest[]) {
  useElicitationStore.setState({ pendingRequests: requests });
}
beforeEach(() => {
  resetRpcLifecycle();
  useElicitationStore.setState({ pendingRequests: [], drafts: {}, respond });
  send.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

it("keeps native single-choice submission hidden until a choice is explicit", () => {
  seed(
    request({
      requestedSchema: {
        type: "object",
        properties: {
          mode: { type: "string", title: "Mode", enum: ["brief", "full"] },
        },
        required: ["mode"],
      },
    }),
  );
  render(<ElicitationItem currentThreadId="owner" />);
  expect(screen.queryByRole("button", { name: "common.submit" })).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "brief" }));
  expect(screen.getByRole("button", { name: "common.submit" })).toBeTruthy();
  expect(send).not.toHaveBeenCalled();
});

it("validates all supported formats and omits cleared optional fields without coercing booleans", () => {
  const fields = elicitationFields(
    request({
      requestedSchema: {
        type: "object",
        properties: {
          email: { type: "string", format: "email" },
          uri: { type: "string", format: "uri" },
          date: { type: "string", format: "date" },
          time: { type: "string", format: "date-time" },
          empty: { type: "number" },
          tags: { type: "array", items: { type: "string", enum: ["a"] } },
          flag: { type: "boolean" },
        },
        required: ["email", "uri", "date", "time", "flag"],
      },
    }),
  );
  const valid = {
    email: "user@example.org",
    uri: "urn:example:search",
    date: "2024-02-29",
    time: "2026-10-10T12:30:00+08:00",
    empty: "",
    tags: [],
    flag: false,
  };
  expect(validateElicitationValues(fields, valid).content).toEqual({
    email: valid.email,
    uri: valid.uri,
    date: valid.date,
    time: valid.time,
    flag: false,
  });
  for (const [id, invalid] of [
    ["email", "user"],
    ["uri", "/relative"],
    ["date", "2026-02-30"],
    ["time", "2026-10-10T25:30:00Z"],
    ["flag", "false"],
  ]) {
    expect(
      validateElicitationValues(fields, { ...valid, [id]: invalid }).content,
    ).toBeNull();
  }
});

it("never treats an empty enum as free text and safely includes schema property names such as __proto__", () => {
  const enumFields = elicitationFields(
    request({
      requestedSchema: {
        type: "object",
        properties: { mode: { type: "string", enum: [] } },
        required: ["mode"],
      },
    }),
  );
  expect(initialElicitationValues(enumFields)).toEqual({});
  expect(
    validateElicitationValues(enumFields, { mode: "invented" }).content,
  ).toBeNull();
  const fields = elicitationFields(
    request({
      requestedSchema: JSON.parse(
        '{"type":"object","properties":{"__proto__":{"type":"string","default":"safe"}},"required":["__proto__"]}',
      ),
    }),
  );
  const content = validateElicitationValues(
    fields,
    initialElicitationValues(fields),
  ).content!;
  expect(Object.hasOwn(content, "__proto__")).toBe(true);
  expect(content["__proto__"]).toBe("safe");
  expect(Object.getPrototypeOf(content)).toBe(Object.prototype);
});

it("isolates a same-turn replacement instance and rejects a stale captured target", async () => {
  const first = request({ requestToken: "old-instance" });
  seed(first);
  render(<ElicitationItem currentThreadId="owner" />);
  fireEvent.change(screen.getByRole("textbox", { name: "Query" }), {
    target: { value: "old draft" },
  });
  const next = request({ requestToken: "new-instance" });
  act(() => seed(next));
  expect(
    (screen.getByRole("textbox", { name: "Query" }) as HTMLTextAreaElement)
      .value,
  ).toBe("");
  await expect(
    respond(31, "accept", { query: "old draft" }, null, first),
  ).rejects.toThrow("请求已过期");
  expect(send).not.toHaveBeenCalled();
});

it("accepts supported openai/form primitives with const values, typed defaults and pattern validation", async () => {
  const value = request({
    mode: "openai/form",
    requestedSchema: {
      type: "object",
      properties: {
        code: { type: "string", title: "Code", pattern: "^[A-Z]{2}$" },
        mode: {
          type: "string",
          title: "Mode",
          oneOf: [{ const: "safe-value", title: "Safe label" }],
        },
        enabled: { type: "boolean", title: "Enabled", default: false },
      },
      required: ["code", "mode", "enabled"],
    },
  } as Partial<ElicitationRequest>);
  seed(value);
  render(<ElicitationItem currentThreadId="owner" />);
  fireEvent.change(screen.getByRole("textbox", { name: "Code" }), {
    target: { value: "invalid" },
  });
  fireEvent.click(screen.getByRole("button", { name: "common.continue" }));
  expect(screen.getByText("elicitation.validation.pattern")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "Code" }), {
    target: { value: "AB" },
  });
  fireEvent.click(screen.getByRole("button", { name: "common.continue" }));
  fireEvent.click(screen.getByRole("radio", { name: "Safe label" }));
  fireEvent.click(screen.getByRole("button", { name: "common.continue" }));
  fireEvent.click(screen.getByRole("button", { name: "common.submit" }));
  await waitFor(() =>
    expect(send.mock.calls[0]?.[2]).toEqual({
      code: "AB",
      mode: "safe-value",
      enabled: false,
    }),
  );
});

it("uses native suggestion plus custom semantics without auto-advancing suggestions", async () => {
  vi.useFakeTimers();
  seed(
    request({
      mode: "openai/form",
      requestedSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            title: "Query",
            minLength: 2,
            "x-openai-suggestions": [
              {
                const: "brief",
                title: "Suggested",
                description: "A native suggested value",
              },
            ],
          },
          tags: {
            type: "array",
            title: "Tags",
            minItems: 2,
            maxItems: 2,
            uniqueItems: true,
            items: {
              type: "string",
              minLength: 2,
              "x-openai-suggestions": [{ const: "alpha", title: "Alpha" }],
            },
          },
        },
        required: ["query", "tags"],
      },
    } as Partial<ElicitationRequest>),
  );
  render(<ElicitationItem currentThreadId="owner" />);
  fireEvent.click(screen.getByRole("radio", { name: "Suggested" }));
  await act(async () => vi.advanceTimersByTime(180));
  expect(screen.getByRole("radio", { name: "Suggested" })).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "userInput.other" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Query" }), {
    target: { value: "my custom value" },
  });
  fireEvent.click(screen.getByRole("button", { name: "common.continue" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Alpha" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Tags" }), {
    target: { value: "custom tag" },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "common.submit" })),
  );
  expect(send.mock.calls[0]?.[2]).toEqual({
    query: "my custom value",
    tags: ["alpha", "custom tag"],
  });
});

it("keeps the exact unsupported native field gap visible and never partially accepts a file/upload form", async () => {
  const value = request({
    mode: "openai/form",
    requestedSchema: {
      type: "object",
      properties: {
        query: { type: "string", title: "Query" },
        source: {
          type: "string",
          format: "uri",
          "x-openai-input": { type: "file", options: [], userOptions: {} },
        },
      },
    },
  } as Partial<ElicitationRequest>);
  seed(value);
  render(<ElicitationItem currentThreadId="owner" />);
  expect(screen.getByText("elicitation.unsupportedField")).toBeTruthy();
  expect(
    screen
      .getByText("elicitation.unsupportedField")
      .getAttribute("data-unsupported-field"),
  ).toBe("source");
  expect(
    screen
      .getByText("elicitation.unsupportedField")
      .getAttribute("data-unsupported-kind"),
  ).toBe("x-openai-input/file");
  await expect(
    respond(31, "accept", { query: "partial" }, null, value),
  ).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});

it("shows one field at a time and single-select advances after the native 180ms delay without submitting the last field", async () => {
  vi.useFakeTimers();
  seed(
    request({
      requestedSchema: {
        type: "object",
        properties: {
          mode: { type: "string", title: "Mode", enum: ["brief", "full"] },
          query: { type: "string", title: "Query", minLength: 1 },
          finish: { type: "string", title: "Finish", enum: ["done"] },
        },
        required: ["mode", "query", "finish"],
      },
    }),
  );
  render(<ElicitationItem currentThreadId="owner" />);
  expect(screen.queryByRole("textbox", { name: "Query" })).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: "brief" }));
  await act(async () => vi.advanceTimersByTime(179));
  expect(screen.getByRole("radio", { name: "brief" })).toBeTruthy();
  await act(async () => vi.advanceTimersByTime(1));
  fireEvent.change(screen.getByRole("textbox", { name: "Query" }), {
    target: { value: "typed query" },
  });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Query" }), {
    key: "Enter",
    ctrlKey: true,
  });
  fireEvent.click(screen.getByRole("radio", { name: "done" }));
  await act(async () => vi.advanceTimersByTime(180));
  expect(screen.getByRole("radio", { name: "done" })).toBeTruthy();
  expect(send).not.toHaveBeenCalled();
  await act(async () =>
    fireEvent.keyDown(screen.getByRole("radio", { name: "done" }), {
      key: "Enter",
      metaKey: true,
    }),
  );
  expect(send).toHaveBeenCalledTimes(1);
});

it("keeps keyboard navigation local, ignores text and IME keys, and Escape collapses without a reply", () => {
  seed(
    request({
      requestedSchema: {
        type: "object",
        properties: {
          query: { type: "string", title: "Query", minLength: 1 },
          mode: { type: "string", title: "Mode", enum: ["brief", "full"] },
        },
        required: ["query", "mode"],
      },
    }),
  );
  const { container } = render(<ElicitationItem currentThreadId="owner" />);
  const query = screen.getByRole("textbox", { name: "Query" });
  fireEvent.keyDown(query, { key: "ArrowRight" });
  fireEvent.keyDown(query, { key: "1", isComposing: true });
  fireEvent.keyDown(query, { key: "Enter", ctrlKey: true, isComposing: true });
  expect(screen.getByRole("textbox", { name: "Query" })).toBeTruthy();
  fireEvent.keyDown(query, { key: "Enter", ctrlKey: true });
  expect(screen.getByText("elicitation.validation.minLength")).toBeTruthy();
  fireEvent.change(query, { target: { value: "saved answer" } });
  fireEvent.keyDown(query, { key: "Escape" });
  expect(screen.queryByRole("textbox", { name: "Query" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "userInput.expand" }));
  expect(
    (screen.getByRole("textbox", { name: "Query" }) as HTMLTextAreaElement)
      .value,
  ).toBe("saved answer");
  fireEvent.keyDown(container.querySelector(".codex-elicitation")!, {
    key: "ArrowRight",
  });
  expect(screen.getByRole("radio", { name: "brief" })).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("radio", { name: "brief" }), { key: "2" });
  expect(
    (screen.getByRole("radio", { name: "full" }) as HTMLInputElement).checked,
  ).toBe(true);
  fireEvent.keyDown(screen.getByRole("radio", { name: "brief" }), {
    key: "ArrowLeft",
  });
  expect(screen.getByRole("textbox", { name: "Query" })).toBeTruthy();
  expect(send).not.toHaveBeenCalled();
});

it("cancels delayed advance on request switches and retains the original field navigation", async () => {
  vi.useFakeTimers();
  const first = request({
    requestedSchema: {
      type: "object",
      properties: {
        mode: { type: "string", title: "Mode", enum: ["brief"] },
        query: { type: "string", title: "Query" },
      },
    },
  });
  const other = request({ threadId: "other" });
  seed(first, other);
  const { rerender } = render(<ElicitationItem currentThreadId="owner" />);
  fireEvent.click(screen.getByRole("radio", { name: "brief" }));
  rerender(<ElicitationItem currentThreadId="other" />);
  await act(async () => vi.advanceTimersByTime(180));
  rerender(<ElicitationItem currentThreadId="owner" />);
  expect(screen.getByRole("radio", { name: "brief" })).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "Query" })).toBeNull();
  expect(send).not.toHaveBeenCalled();
});

it("uses the native form surface with textarea and explicit enum choices", () => {
  seed(
    request({
      requestedSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            title: "Query",
            description: "Describe the search",
          },
          mode: {
            type: "string",
            title: "Mode",
            oneOf: [
              { const: "brief", title: "Brief" },
              { const: "full", title: "Full" },
            ],
          },
        },
      },
    }),
  );
  const { container } = render(<ElicitationItem currentThreadId="owner" />);
  expect(container.querySelector(".codex-elicitation")).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Query" }).tagName).toBe(
    "TEXTAREA",
  );
  expect(screen.getByText("Describe the search")).toBeTruthy();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.queryByRole("radio", { name: "Brief" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "userInput.next" }));
  expect(screen.getByRole("radio", { name: "Brief" })).toBeTruthy();
});

it("honors native defaults and sends number, boolean and multi-select values with their types", async () => {
  const value = request({
    requestedSchema: {
      type: "object",
      properties: {
        query: { type: "string", title: "Query", default: "graph search" },
        count: {
          type: "integer",
          title: "Count",
          minimum: 1,
          maximum: 5,
          default: 2,
        },
        enabled: { type: "boolean", title: "Enabled", default: false },
        tags: {
          type: "array",
          title: "Tags",
          minItems: 1n,
          maxItems: 2n,
          items: {
            anyOf: [
              { const: "a", title: "Alpha" },
              { const: "b", title: "Beta" },
            ],
          },
          default: ["a", "unknown"],
        },
      },
      required: ["query", "count", "enabled", "tags"],
    },
  });
  seed(value);
  render(<ElicitationItem currentThreadId="owner" />);
  expect(
    (screen.getByRole("textbox", { name: "Query" }) as HTMLTextAreaElement)
      .value,
  ).toBe("graph search");
  fireEvent.click(screen.getByRole("button", { name: "common.continue" }));
  expect(
    (screen.getByRole("spinbutton", { name: "Count" }) as HTMLInputElement)
      .value,
  ).toBe("2");
  fireEvent.click(screen.getByRole("button", { name: "common.continue" }));
  expect(
    (screen.getByRole("checkbox", { name: "Enabled" }) as HTMLInputElement)
      .checked,
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "common.continue" }));
  expect(
    (screen.getByRole("checkbox", { name: "Alpha" }) as HTMLInputElement)
      .checked,
  ).toBe(true);
  fireEvent.click(screen.getByRole("checkbox", { name: "Beta" }));
  fireEvent.click(screen.getByRole("button", { name: "common.submit" }));
  await waitFor(() =>
    expect(send).toHaveBeenCalledWith(
      31,
      "accept",
      { query: "graph search", count: 2, enabled: false, tags: ["a", "b"] },
      null,
      { threadId: "owner", requestId: 31, turnId: "turn", itemId: null },
    ),
  );
});

it("retains drafts across thread switches and isolates reused request ids by turn and instance token", () => {
  const first = request();
  const other = request({ threadId: "other" });
  seed(first, other);
  const { rerender } = render(<ElicitationItem currentThreadId="owner" />);
  fireEvent.change(screen.getByRole("textbox", { name: "Query" }), {
    target: { value: "first draft" },
  });
  rerender(<ElicitationItem currentThreadId="other" />);
  expect(
    (screen.getByRole("textbox", { name: "Query" }) as HTMLTextAreaElement)
      .value,
  ).toBe("");
  fireEvent.change(screen.getByRole("textbox", { name: "Query" }), {
    target: { value: "other draft" },
  });
  rerender(<ElicitationItem currentThreadId="owner" />);
  expect(
    (screen.getByRole("textbox", { name: "Query" }) as HTMLTextAreaElement)
      .value,
  ).toBe("first draft");
  act(() =>
    seed(
      request({
        turnId: "next-turn",
        requestToken: "new-instance",
      } as Partial<ElicitationRequest>),
      other,
    ),
  );
  expect(
    (screen.getByRole("textbox", { name: "Query" }) as HTMLTextAreaElement)
      .value,
  ).toBe("");
});

it("validates integer bounds and clearing a number cannot submit zero", async () => {
  seed(
    request({
      requestedSchema: {
        type: "object",
        properties: {
          count: {
            type: "integer",
            title: "Count",
            minimum: 1,
            maximum: 3,
            default: 2,
          },
        },
        required: ["count"],
      },
    }),
  );
  render(<ElicitationItem currentThreadId="owner" />);
  const count = screen.getByRole("spinbutton", { name: "Count" });
  for (const [value, error] of [
    ["1.5", "integer"],
    ["0", "minimum"],
    ["4", "maximum"],
    ["", "required"],
  ]) {
    fireEvent.change(count, { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "common.submit" }));
    await waitFor(() =>
      expect(screen.getByText(`elicitation.validation.${error}`)).toBeTruthy(),
    );
    expect(count.getAttribute("aria-invalid")).toBe("true");
  }
  expect(send).not.toHaveBeenCalled();
});

it("validates text length, format and multi-select bounds before delivery", async () => {
  seed(
    request({
      requestedSchema: {
        type: "object",
        properties: {
          query: { type: "string", title: "Query", minLength: 2, maxLength: 4 },
          email: { type: "string", title: "Email", format: "email" },
          tags: {
            type: "array",
            title: "Tags",
            minItems: 2n,
            maxItems: 2n,
            items: { type: "string", enum: ["a", "b", "c"] },
          },
        },
        required: ["query", "email", "tags"],
      },
    }),
  );
  render(<ElicitationItem currentThreadId="owner" />);
  fireEvent.change(screen.getByRole("textbox", { name: "Query" }), {
    target: { value: "a" },
  });
  fireEvent.click(screen.getByRole("button", { name: "userInput.next" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Email" }), {
    target: { value: "invalid" },
  });
  fireEvent.click(screen.getByRole("button", { name: "userInput.next" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "a" }));
  fireEvent.click(screen.getByRole("button", { name: "common.submit" }));
  await waitFor(() =>
    expect(screen.getByText("elicitation.validation.minLength")).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "userInput.next" }));
  expect(screen.getByText("elicitation.validation.format")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "userInput.next" }));
  expect(screen.getByText("elicitation.validation.minItems")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "userInput.previous" }));
  fireEvent.click(screen.getByRole("button", { name: "userInput.previous" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Query" }), {
    target: { value: "longer" },
  });
  fireEvent.click(screen.getByRole("button", { name: "userInput.next" }));
  fireEvent.click(screen.getByRole("button", { name: "userInput.next" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "b" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "c" }));
  fireEvent.click(screen.getByRole("button", { name: "common.submit" }));
  await waitFor(() =>
    expect(screen.getByText("elicitation.validation.maxLength")).toBeTruthy(),
  );
  fireEvent.click(screen.getByRole("button", { name: "userInput.next" }));
  fireEvent.click(screen.getByRole("button", { name: "userInput.next" }));
  expect(screen.getByText("elicitation.validation.maxItems")).toBeTruthy();
  expect(send).not.toHaveBeenCalled();
});

it("retains a draft after a confirmed rejection and disables every reply when delivery is uncertain", async () => {
  const value = request();
  seed(value);
  send.mockRejectedValueOnce(new SessionApiError("invalid answer", 400));
  render(<ElicitationItem currentThreadId="owner" />);
  fireEvent.change(screen.getByRole("textbox", { name: "Query" }), {
    target: { value: "keep my answer" },
  });
  fireEvent.click(screen.getByRole("button", { name: "common.submit" }));
  await waitFor(() =>
    expect(useRpcDeliveryStore.getState().states[rpcKey(value)]?.phase).toBe(
      "failed",
    ),
  );
  expect(
    (screen.getByRole("textbox", { name: "Query" }) as HTMLTextAreaElement)
      .value,
  ).toBe("keep my answer");
  send.mockRejectedValueOnce(new Error("connection lost"));
  fireEvent.click(screen.getByRole("button", { name: "common.submit" }));
  await waitFor(() =>
    expect(useRpcDeliveryStore.getState().states[rpcKey(value)]?.phase).toBe(
      "uncertain",
    ),
  );
  for (const name of ["common.submit", "common.decline", "common.cancel"]) {
    const button = screen.getByRole("button", { name }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
  }
  expect(send).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "核对状态" })).toBeTruthy();
});

it("settles only the captured request and does not clear another thread draft after late delivery", async () => {
  let finish!: () => void;
  send.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const first = request(),
    other = request({ threadId: "other" });
  seed(first, other);
  const { rerender } = render(<ElicitationItem currentThreadId="owner" />);
  fireEvent.change(screen.getByRole("textbox", { name: "Query" }), {
    target: { value: "first answer" },
  });
  fireEvent.click(screen.getByRole("button", { name: "common.submit" }));
  rerender(<ElicitationItem currentThreadId="other" />);
  fireEvent.change(screen.getByRole("textbox", { name: "Query" }), {
    target: { value: "other answer" },
  });
  expect(
    (screen.getByRole("button", { name: "common.submit" }) as HTMLButtonElement)
      .disabled,
  ).toBe(false);
  await act(async () => finish());
  expect(
    (screen.getByRole("textbox", { name: "Query" }) as HTMLTextAreaElement)
      .value,
  ).toBe("other answer");
  expect(useElicitationStore.getState().pendingRequests).toEqual([other]);
  expect(send.mock.calls[0]?.[4]).toMatchObject({
    threadId: "owner",
    requestId: 31,
    turnId: "turn",
  });
});

it("requires an explicit value for required booleans and enums and rejects invalid enum content in the store", async () => {
  const value = request({
    requestedSchema: {
      type: "object",
      properties: {
        enabled: { type: "boolean", title: "Enabled" },
        mode: {
          type: "string",
          title: "Mode",
          enum: ["brief", "full"],
          default: "full",
        },
      },
      required: ["enabled", "mode"],
    },
  });
  seed(value);
  render(<ElicitationItem currentThreadId="owner" />);
  fireEvent.click(screen.getByRole("button", { name: "common.continue" }));
  await waitFor(() =>
    expect(screen.getByText("elicitation.validation.required")).toBeTruthy(),
  );
  await expect(
    respond(31, "accept", { enabled: false, mode: "invented" }, null, value),
  ).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Enabled" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Enabled" }));
  fireEvent.click(screen.getByRole("button", { name: "common.continue" }));
  expect(
    (screen.getByRole("radio", { name: "full" }) as HTMLInputElement).checked,
  ).toBe(false);
  fireEvent.keyDown(screen.getByRole("radio", { name: "full" }), {
    key: "Enter",
    ctrlKey: true,
  });
  expect(screen.getByText("elicitation.validation.required")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "brief" }));
  fireEvent.click(screen.getByRole("button", { name: "common.submit" }));
  await waitFor(() =>
    expect(send.mock.calls[0]?.[2]).toEqual({ enabled: false, mode: "brief" }),
  );
});

it("does not invent secret controls or accept an unsupported openai form schema", () => {
  seed(
    request({
      mode: "openai/form",
      requestedSchema: {
        type: "object",
        properties: { password: { type: "string", format: "password" } },
      },
    } as Partial<ElicitationRequest>),
  );
  const { container } = render(<ElicitationItem currentThreadId="owner" />);
  expect(container.querySelector("input[type=password]")).toBeNull();
  expect(screen.getByText("elicitation.unsupportedField")).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "common.submit" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it("keeps URL authorization and message-only decisions attached to their captured identity", async () => {
  const url = request({
    mode: "url",
    url: "https://example.org/authorize",
    elicitationId: "authorization",
  } as Partial<ElicitationRequest>);
  seed(url);
  const opened = vi.spyOn(window, "open").mockImplementation(() => null);
  const { rerender } = render(<ElicitationItem currentThreadId="owner" />);
  fireEvent.click(screen.getByRole("button", { name: "elicitation.openLink" }));
  expect(opened).toHaveBeenCalledWith(
    url.mode === "url" ? url.url : "",
    "_blank",
    "noopener,noreferrer",
  );
  fireEvent.click(screen.getByRole("button", { name: "common.done" }));
  await waitFor(() => expect(send.mock.calls[0]?.[1]).toBe("accept"));
  const approval = request({
    requestedSchema: { type: "object", properties: {} },
    _meta: { persist: ["session"] },
  });
  act(() => seed(approval));
  rerender(<ElicitationItem currentThreadId="owner" />);
  expect(screen.queryByRole("button", { name: "Always allow" })).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Allow for this session" }),
  );
  await waitFor(() =>
    expect(send.mock.calls[1]).toEqual([
      31,
      "accept",
      null,
      { persist: "session" },
      { threadId: "owner", requestId: 31, turnId: "turn", itemId: null },
    ]),
  );
  opened.mockRestore();
});
