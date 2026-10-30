export type VoicePhase = "idle" | "starting" | "active" | "stopping" | "failed";
export interface VoiceDependencies {
  claim: (signal: AbortSignal) => Promise<() => void>;
  microphone: () => Promise<MediaStream>;
  peer: () => RTCPeerConnection;
  start: (sdp: string, signal: AbortSignal) => Promise<{ sdp: string }>;
  stop: () => Promise<unknown>;
  sendText?: (text: string) => Promise<void>;
  current: () => boolean;
  canStop?: () => boolean;
  phase: (phase: VoicePhase) => void;
  audio: (stream: MediaStream | null) => void;
  error: (message: string) => void;
}
/** Owns only one browser audio session. It never resumes, interrupts or switches an Agent task. */
export class RealtimeVoiceController {
  private controller?: AbortController;
  private stream?: MediaStream;
  private connection?: RTCPeerConnection;
  private release?: () => void;
  private submitted = false;
  private textUnknown = false;
  constructor(private dependencies: VoiceDependencies) {}
  private valid(controller: AbortController) {
    if (
      controller.signal.aborted ||
      this.controller !== controller ||
      !this.dependencies.current()
    )
      throw new Error("语音目标或连接已变化");
  }
  async start() {
    if (this.controller) throw new Error("语音连接已在进行中");
    const controller = new AbortController();
    this.controller = controller;
    this.dependencies.phase("starting");
    try {
      const release = await this.dependencies.claim(controller.signal);
      try {
        this.valid(controller);
      } catch (reason) {
        release();
        throw reason;
      }
      this.release = release;
      const stream = await this.dependencies.microphone();
      if (controller.signal.aborted || !this.dependencies.current()) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("已取消麦克风启动");
      }
      this.stream = stream;
      const peer = this.dependencies.peer();
      this.connection = peer;
      for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);
      peer.createDataChannel("oai-events");
      peer.ontrack = (event) => {
        if (
          this.controller === controller &&
          !controller.signal.aborted &&
          this.dependencies.current()
        )
          this.dependencies.audio(
            event.streams[0] ?? new MediaStream([event.track]),
          );
      };
      peer.onconnectionstatechange = () => {
        if (
          ["failed", "closed"].includes(peer.connectionState) &&
          this.controller === controller
        )
          void this.stop();
      };
      const offer = await peer.createOffer();
      this.valid(controller);
      await peer.setLocalDescription(offer);
      if (peer.iceGatheringState !== "complete")
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            cleanup();
            resolve();
          }, 5000);
          const change = () => {
            if (peer.iceGatheringState === "complete") {
              cleanup();
              resolve();
            }
          };
          const abort = () => {
            cleanup();
            reject(new Error("已取消语音启动"));
          };
          function cleanup() {
            clearTimeout(timer);
            peer.removeEventListener("icegatheringstatechange", change);
            controller.signal.removeEventListener("abort", abort);
          }
          peer.addEventListener("icegatheringstatechange", change);
          controller.signal.addEventListener("abort", abort, { once: true });
        });
      this.valid(controller);
      const sdp = peer.localDescription?.sdp;
      if (!sdp) throw new Error("无法建立浏览器语音连接");
      this.submitted = true;
      const answer = await this.dependencies.start(sdp, controller.signal);
      this.valid(controller);
      await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
      this.valid(controller);
      this.dependencies.phase("active");
    } catch (reason) {
      if (this.controller === controller) {
        const current =
            this.dependencies.canStop?.() ?? this.dependencies.current(),
          cancelled = controller.signal.aborted;
        const submitted = this.submitted;
        this.releaseResources();
        if (submitted && current) void this.dependencies.stop().catch(() => {});
        if (!cancelled) {
          this.dependencies.phase("failed");
          this.dependencies.error(
            reason instanceof Error ? reason.message : String(reason),
          );
        }
      }
    }
  }
  async sendText(text: string) {
    if (
      !this.controller ||
      !this.submitted ||
      !this.dependencies.current() ||
      !this.dependencies.sendText
    )
      throw new Error("语音连接不可用，草稿已保留。");
    if (this.textUnknown)
      throw new Error("上一条语音文字回执未知，请先核对；不会重复发送。");
    this.textUnknown = true;
    await this.dependencies.sendText(text);
    this.textUnknown = false;
  }

  mute(muted: boolean) {
    for (const track of this.stream?.getAudioTracks() ?? [])
      track.enabled = !muted;
  }
  private releaseResources() {
    const controller = this.controller;
    this.controller = undefined;
    controller?.abort();
    this.connection?.close();
    this.connection = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.release?.();
    this.release = undefined;
    this.submitted = false;
    this.dependencies.audio(null);
  }
  async stop() {
    if (!this.controller) return true;
    const submitted = this.submitted,
      current = this.dependencies.canStop?.() ?? this.dependencies.current();
    this.releaseResources();
    this.dependencies.phase("stopping");
    try {
      if (submitted && current) await this.dependencies.stop();
      this.dependencies.phase("idle");
      return true;
    } catch (reason) {
      this.dependencies.phase("failed");
      this.dependencies.error(
        "语音结束回执未知；麦克风已释放，不会重发。" +
          String(reason instanceof Error ? reason.message : reason),
      );
      return false;
    }
  }
  revoke() {
    this.releaseResources();
    this.dependencies.phase("idle");
  }
}
