'use strict';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
function threadUri(threadId, allowed) {
  if (typeof threadId !== 'string' || !uuid.test(threadId) || !allowed.includes(threadId)) throw new Error('thread must be an explicit allowlisted local UUID');
  return `openai-codex://route/local/${threadId}`;
}
function validateOpen(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'column,threadId') throw new Error('expected only threadId and column');
  const uri = threadUri(body.threadId, allowed);
  if (!Number.isInteger(body.column) || body.column < 1 || body.column > 3) throw new Error('column must be 1, 2 or 3');
  return { uri, threadId: body.threadId, column: body.column };
}
async function openThread(vscode, body, allowed) {
  const captured = validateOpen(body, allowed);
  await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.parse(captured.uri), 'chatgpt.conversationEditor',
    { viewColumn: captured.column, preview: false, preserveFocus: false });
  return captured;
}
function validateFixturePanels(capturedFixtures) {
  if (capturedFixtures.length !== 2 || capturedFixtures[0] === capturedFixtures[1]) throw new Error('two distinct fixture threads required');
  return capturedFixtures.map((threadId, index) => validateOpen({ threadId, column: index + 1 }, capturedFixtures));
}
async function openFixturePanels(vscode, capturedFixtures, assertActive = () => {}) {
  const panels = validateFixturePanels(capturedFixtures);
  const result = [];
  for (const panel of panels) { assertActive(); result.push(await openThread(vscode, { threadId: panel.threadId, column: panel.column }, capturedFixtures)); }
  return result;
}
function newChatUri(windowId, allowed) {
  if (typeof windowId !== 'string' || !uuid.test(windowId) || !allowed.includes(windowId)) throw new Error('new chat window must be an explicit allowlisted local UUID');
  return `openai-codex://route/extension/panel/new?nativeCodexPanel=${windowId}`;
}
function validateNewChatPanels(capturedWindows) {
  if (!Array.isArray(capturedWindows) || capturedWindows.length !== 2 || capturedWindows[0] === capturedWindows[1]) throw new Error('two distinct new chat window UUIDs required');
  return capturedWindows.map((windowId, index) => ({ uri: newChatUri(windowId, capturedWindows), windowId, column: index + 1, kind: 'new-chat' }));
}
async function openNewChatPanels(vscode, capturedWindows, assertActive = () => {}) {
  const panels = validateNewChatPanels(capturedWindows);
  const result = [];
  for (const panel of panels) {
    assertActive();
    await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.parse(panel.uri), 'chatgpt.conversationEditor',
      { viewColumn: panel.column, preview: false, preserveFocus: false });
    result.push(panel);
  }
  return result;
}
module.exports = { threadUri, validateOpen, openThread, validateFixturePanels, openFixturePanels, newChatUri, validateNewChatPanels, openNewChatPanels };
