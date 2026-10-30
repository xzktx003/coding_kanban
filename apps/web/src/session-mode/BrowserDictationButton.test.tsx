import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BrowserDictationButton } from "./BrowserDictationButton";

const api = vi.hoisted(() => ({
  transcribe: vi.fn(),
  media: vi.fn(),
  stop: vi.fn(),
  close: vi.fn(),
  resume: vi.fn(),
  claim: vi.fn(),
  release: vi.fn(),
}));
vi.mock("./features/audio/microphoneLease", () => ({ claimMicrophone: api.claim }));
vi.mock("./services/apiAdapt/shared", () => ({
  postJsonWithOptions: api.transcribe,
}));
vi.mock("./services/apiAdapt/dictation", () => ({
  dictationModelStatus: vi.fn(),
  dictationDownloadModel: vi.fn(),
  dictationCancelDownload: vi.fn(),
}));
vi.mock("./components/codex/composer/DictationPopoverContent", () => ({
  DictationPopoverContent: () => null,
}));
vi.mock("./components/ui/popover", () => ({
  Popover: ({ children }: any) => children,
  PopoverTrigger: ({ children }: any) => children,
  PopoverContent: () => null,
}));
beforeEach(() => {
  vi.clearAllMocks();
  api.transcribe.mockReset();
  api.media.mockReset();
  api.resume.mockReset().mockResolvedValue(undefined);
  api.claim.mockReset().mockResolvedValue(api.release);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: api.media },
  });
  vi.stubGlobal(
    "AudioContext",
    class {
      state = "running";
      sampleRate = 48000;
      destination = {};
      resume = api.resume;
      close = api.close.mockResolvedValue(undefined);
      createMediaStreamSource = () => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
      });
      createScriptProcessor = () => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
        onaudioprocess: null,
      });
    },
  );
  api.media.mockResolvedValue({ getTracks: () => [{ stop: api.stop }] });
});

it("cancels an AudioContext still waiting to resume and releases it immediately", async () => {
  let resume!: () => void;
  api.resume.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        resume = resolve;
      }),
  );
  render(<BrowserDictationButton onTranscript={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "听写" }));
  await waitFor(() => expect(api.resume).toHaveBeenCalledTimes(1));
  fireEvent.click(
    screen.getByRole("button", { name: "正在启动听写；点击可取消" }),
  );
  expect(api.stop).toHaveBeenCalledTimes(1);
  expect(api.close).toHaveBeenCalledTimes(1);
  await act(async () => resume());
  expect(api.stop).toHaveBeenCalledTimes(1);
  expect(api.close).toHaveBeenCalledTimes(1);
});
afterEach(() => vi.unstubAllGlobals());

it("cancels pending microphone permission and releases a late stream without recording", async () => {
  let grant!: (value: unknown) => void;
  api.media.mockImplementation(
    () =>
      new Promise((resolve) => {
        grant = resolve;
      }),
  );
  const onTranscript = vi.fn();
  render(<BrowserDictationButton onTranscript={onTranscript} />);
  fireEvent.click(screen.getByRole("button", { name: "听写" }));
  const cancel = screen.getByRole("button", {
    name: "正在启动听写；点击可取消",
  });
  await waitFor(() => expect(api.media).toHaveBeenCalledTimes(1));
  expect((cancel as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(cancel);
  await act(async () => grant({ getTracks: () => [{ stop: api.stop }] }));
  expect(api.stop).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "听写" })).toBeTruthy();
  expect(api.transcribe).not.toHaveBeenCalled();
  expect(api.release).toHaveBeenCalledTimes(1);
  expect(onTranscript).not.toHaveBeenCalled();
});

it("releases a late microphone lease after starting was cancelled without requesting hardware", async () => {
  let claim!: (release: () => void) => void;
  api.claim.mockReturnValue(new Promise<() => void>((resolve) => { claim = resolve; }));
  render(<BrowserDictationButton onTranscript={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "听写" }));
  expect(api.claim).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "正在启动听写；点击可取消" }));
  await act(async () => claim(api.release));
  expect(api.release).toHaveBeenCalledTimes(1);
  expect(api.media).not.toHaveBeenCalled();
});

it("retries the same captured audio and original transcript owner after a recoverable failure", async () => {
  const first = vi.fn(),
    second = vi.fn();
  api.transcribe
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ text: "captured" });
  const { rerender } = render(<BrowserDictationButton onTranscript={first} />);
  fireEvent.click(screen.getByRole("button", { name: "听写" }));
  await screen.findByRole("button", { name: "停止听写" });
  rerender(<BrowserDictationButton onTranscript={second} />);
  fireEvent.click(screen.getByRole("button", { name: "停止听写" }));
  await screen.findByRole("button", { name: "重试转写" });
  fireEvent.click(screen.getByRole("button", { name: "重试转写" }));
  await waitFor(() =>
    expect(first).toHaveBeenCalledWith("captured", { send: false }),
  );
  expect(second).not.toHaveBeenCalled();
  expect(api.transcribe.mock.calls[1].slice(0, 2)).toEqual(
    api.transcribe.mock.calls[0].slice(0, 2),
  );
  expect(api.media).toHaveBeenCalledTimes(1);
  expect(api.stop).toHaveBeenCalledTimes(1);
});

it("unmount invalidates a pending transcript and releases capture resources", async () => {
  let complete!: (value: unknown) => void;
  api.transcribe.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const onTranscript = vi.fn();
  const { unmount } = render(
    <BrowserDictationButton onTranscript={onTranscript} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "听写" }));
  await screen.findByRole("button", { name: "停止听写" });
  fireEvent.click(screen.getByRole("button", { name: "停止听写" }));
  await waitFor(() => expect(api.transcribe).toHaveBeenCalledTimes(1));
  unmount();
  await act(async () => complete({ text: "late" }));
  expect(onTranscript).not.toHaveBeenCalled();
  expect(api.stop).toHaveBeenCalledTimes(1);
  expect(api.close).toHaveBeenCalledTimes(1);
});
