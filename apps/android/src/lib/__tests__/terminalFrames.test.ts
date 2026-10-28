import { parseTerminalFrame } from "../terminalFrames";

describe("parseTerminalFrame", () => {
  it("treats non-JSON frames as raw terminal output", () => {
    const frame = parseTerminalFrame("\u001b[31mhello\u001b[0m");
    expect(frame).toEqual({ kind: "output", data: "\u001b[31mhello\u001b[0m" });
  });

  it("treats JSON without the control marker as output", () => {
    const frame = parseTerminalFrame('{"a":1}');
    expect(frame.kind).toBe("output");
  });

  it("parses a replay control frame", () => {
    const frame = parseTerminalFrame(
      '{"__agentOrchestrator":"terminal-control","event":"replay","data":"\\u001b[32mreplay\\u001b[0m"}',
    );
    expect(frame).toEqual({
      kind: "replay",
      data: "\u001b[32mreplay\u001b[0m",
    });
  });

  it("parses replay-complete", () => {
    const frame = parseTerminalFrame(
      '{"__agentOrchestrator":"terminal-control","event":"replay-complete"}',
    );
    expect(frame).toEqual({ kind: "replay-complete" });
  });

  it("returns unknown for other control frames", () => {
    const frame = parseTerminalFrame(
      '{"__agentOrchestrator":"terminal-control","event":"other"}',
    );
    expect(frame.kind).toBe("unknown");
  });
});
