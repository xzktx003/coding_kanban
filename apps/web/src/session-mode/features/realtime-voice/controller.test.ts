import { expect, it, vi } from "vitest";
import { RealtimeVoiceController } from "./controller";
function fixture() {
  const track = { enabled: true, stop: vi.fn() },
    stream = {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    } as unknown as MediaStream;
  const peer = {
    addTrack: vi.fn(),
    createDataChannel: vi.fn(),
    createOffer: vi.fn(async () => ({ type: "offer", sdp: "v=0" })),
    setLocalDescription: vi.fn(async () => {}),
    setRemoteDescription: vi.fn(async () => {}),
    iceGatheringState: "complete",
    localDescription: { sdp: "v=0" },
    close: vi.fn(),
  } as unknown as RTCPeerConnection;
  const release = vi.fn(),
    deps = {
      claim: vi.fn(async () => release),
      microphone: vi.fn(async () => stream),
      peer: () => peer,
      start: vi.fn(async () => ({ sdp: "v=0\r\nanswer" })),
      stop: vi.fn(async () => {}),
      current: () => true,
      phase: vi.fn(),
      audio: vi.fn(),
      error: vi.fn(),
    };
  return {
    controller: new RealtimeVoiceController(deps),
    deps,
    track,
    release,
    peer,
    stream,
  };
}
it("cancels a pending permission without sending a native start or retaining late tracks", async () => {
  const f = fixture();
  let resolve!: (stream: MediaStream) => void;
  f.deps.microphone.mockReturnValue(new Promise((done) => (resolve = done)));
  const pending = f.controller.start();
  await vi.waitFor(() => expect(f.deps.microphone).toHaveBeenCalled());
  await f.controller.stop();
  resolve(f.stream);
  await pending;
  expect(f.track.stop).toHaveBeenCalledOnce();
  expect(f.release).toHaveBeenCalledOnce();
  expect(f.deps.start).not.toHaveBeenCalled();
});
it("binds one offer, mute and explicit stop to the original owned connection", async () => {
  const f = fixture();
  await f.controller.start();
  expect(f.deps.phase).toHaveBeenLastCalledWith("active");
  f.controller.mute(true);
  expect(f.track.enabled).toBe(false);
  await f.controller.stop();
  expect(f.deps.stop).toHaveBeenCalledOnce();
  expect(f.track.stop).toHaveBeenCalledOnce();
  expect(f.peer.close).toHaveBeenCalledOnce();
});
it("account revocation releases audio without stopping a replacement native session", async () => {
  const f = fixture();
  await f.controller.start();
  f.controller.revoke();
  expect(f.track.stop).toHaveBeenCalledOnce();
  expect(f.deps.stop).not.toHaveBeenCalled();
});
it("releases a late microphone lease after cancellation before permission starts", async () => {
  const f = fixture();
  let finish!: (release: typeof f.release) => void;
  f.deps.claim.mockReturnValueOnce(
    new Promise<typeof f.release>((resolve) => {
      finish = resolve;
    }),
  );
  const started = f.controller.start();
  await vi.waitFor(() => expect(f.deps.claim).toHaveBeenCalledOnce());
  await f.controller.stop();
  finish(f.release);
  await started;
  expect(f.release).toHaveBeenCalledOnce();
  expect(f.deps.microphone).not.toHaveBeenCalled();
  expect(f.deps.start).not.toHaveBeenCalled();
});
it("blocks a second typed send after an unknown receipt and keeps ordinary turn submission outside voice", async () => {
  const f = fixture();
  const sendText = vi.fn(async () => {
    throw new Error("unknown receipt");
  });
  const controller = new RealtimeVoiceController({ ...f.deps, sendText });
  await controller.start();
  await expect(controller.sendText("captured voice input")).rejects.toThrow(
    "unknown receipt",
  );
  await expect(controller.sendText("captured voice input")).rejects.toThrow(
    /回执未知/,
  );
  expect(sendText).toHaveBeenCalledOnce();
  controller.revoke();
});
