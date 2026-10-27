import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { resumeThreadBeside, focusNativeWindow } = createRequire(import.meta.url)('../companion/control.cjs');

test('concurrent restores and focus do not steal focus before the exact editor is verified', async () => {
  const ids = ['019aabcd-1234-7890-abcd-0123456789ab', '019aabcd-1234-7890-abcd-0123456789ac'];
  const tabs = ids.map(id => ({ isActive: false, input: { viewType: 'chatgpt.conversationEditor', uri: `openai-codex://route/local/${id}` } }));
  const group = { viewColumn: 1, tabs };
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const calls = [];
  const vscode = {
    Uri: { parse: uri => uri },
    window: { tabGroups: { all: [group], activeTabGroup: group } },
    commands: { async executeCommand(command, uri) {
      calls.push(uri);
      for (const tab of tabs) tab.isActive = tab.input.uri === uri;
      if (calls.length === 1) await held;
    } },
  };
  const first = resumeThreadBeside(vscode, { threadId: ids[0] });
  const second = focusNativeWindow(vscode, { kind: 'thread', targetId: ids[1] });
  const outcomes = Promise.allSettled([first, second]);
  await new Promise(resolve => setImmediate(resolve));
  const submittedBeforeFirstSettled = calls.length;
  release();
  const results = await outcomes;
  assert.equal(submittedBeforeFirstSettled, 1, 'another command changed the active editor before verification');
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'fulfilled']);
  assert.equal(tabs[1].isActive, true);
});
