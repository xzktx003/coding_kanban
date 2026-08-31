import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("desktop complete records reuse the resizable side-panel workspace", () => {
  const appSource = readFileSync(
    new URL("../App.tsx", import.meta.url),
    "utf8",
  );

  assert.match(appSource, /type SidePanelTool = [^;]*"transcript"[^;]*;/);
  assert.match(
    appSource,
    /<SidePanelView active={transcriptOpen}>[\s\S]*?{transcriptOpen \? \([\s\S]*?<AgentTranscriptDialog[\s\S]*?presentation="panel"[\s\S]*?<\/SidePanelView>/,
  );
  assert.match(
    appSource,
    /onToggleTranscript={[\s\S]*?setOpenSidePanelTool\("transcript"\)/,
  );
  assert.match(
    appSource,
    /function returnToFileBrowser\(session: AgentSessionRecord\)[\s\S]*?setOpenSidePanelTool\("files"\)/,
  );
  assert.match(
    appSource,
    /onClose=\{\(\) => returnToFileBrowser\(focusedSession\)\}/,
  );
  assert.match(
    appSource,
    /if \(transcriptOpen && sessionId === focusedSession\.id\) \{\s*returnToFileBrowser\(focusedSession\);/,
  );
});
