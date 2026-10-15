import { expect, it, vi } from "vitest";
import {
  hasPendingSessionFollowups,
  sendToNativeCodex,
} from "./native-codex-send";

const input = {
  target: {
    threadId: "019aabcd-1234-7890-abcd-0123456789ab",
    cwd: "/workspace/project",
    column: 2,
  },
  submissionId: "019aabcd-1234-7890-abcd-0123456789ac",
  text: "hello native thread",
  images: ["/private/attachment.png"],
  contexts: [],
  mentions: [],
};

it("submits the exact captured thread and editor column with a stable receipt identity", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        accepted: true,
        turnId: "019aabcd-1234-7890-abcd-0123456789ad",
      }),
      { status: 202, headers: { "content-type": "application/json" } },
    ),
  );
  const result = await sendToNativeCodex(input, fetcher);
  expect(result.accepted).toBe(true);
  expect(fetcher).toHaveBeenCalledWith(
    "/api/native-codex/send",
    expect.objectContaining({ method: "POST", cache: "no-store" }),
  );
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
    threadId: input.target.threadId,
    column: input.target.column,
    cwd: input.target.cwd,
    submissionId: input.submissionId,
    text: input.text,
    images: input.images,
    contexts: [],
    mentions: [],
  });
});

it("preserves composer contents when the selected target rejects or loses its receipt", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({ error: "target thread is busy" }), {
      status: 409,
      headers: { "content-type": "application/json" },
    }),
  );
  await expect(sendToNativeCodex(input, fetcher)).rejects.toThrow(
    "target thread is busy",
  );
});

it("allows native delivery when the Session queue is paused but has no unresolved messages", () => {
  expect(
    hasPendingSessionFollowups({
      revision: 0,
      paused: "manual pause",
      items: [],
    }),
  ).toBe(false);
  expect(
    hasPendingSessionFollowups({
      revision: 0,
      paused: "manual pause",
      items: [
        { status: "failed" } as any,
        { status: "cancelled" } as any,
        { status: "sent" } as any,
      ],
    }),
  ).toBe(false);
});

it.each(["queued", "sending", "uncertain"] as const)(
  "keeps native delivery blocked while a Session message is %s",
  (status) => {
    expect(
      hasPendingSessionFollowups({
        revision: 0,
        paused: null,
        items: [{ status } as any],
      }),
    ).toBe(true);
  },
);
it("sends through the selected native client and refuses malformed selectors before delivery", async () => {
  const original = window.location.href;
  const profile = "019aabcd-1234-7890-abcd-000000000041";
  const fetcher = vi.fn<typeof fetch>().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          accepted: true,
          turnId: "019aabcd-1234-7890-abcd-0123456789ad",
        }),
        { status: 202 },
      ),
  );
  try {
    window.history.replaceState(null, "", `/?nativeClient=${profile}`);
    await sendToNativeCodex(input, fetcher);
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      `/api/native-codex/clients/${profile}/send`,
    );
    fetcher.mockClear();
    window.history.replaceState(null, "", "/?nativeClient=invalid");
    await expect(sendToNativeCodex(input, fetcher)).rejects.toThrow(
      /客户端标识/,
    );
    expect(fetcher).not.toHaveBeenCalled();
  } finally {
    window.history.replaceState(null, "", original);
  }
});
