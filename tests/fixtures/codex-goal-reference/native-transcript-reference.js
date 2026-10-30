// Current pinned official renderer, with a read-only host fixture only.
import "./native-goal-reference.js";
import * as Transcript from "./assets/sites-end-resource-733bd1c6da06.js";
import * as Auth from "./assets/app-initial-fee819fe4f22.js";

try {
  Transcript.O();
  Auth.xgt();
  const { Core, Native, R, wrap, root } = window.nativeGoalCore;
  window.nativeTranscriptModules = { Transcript, Core, Native, R };
  window.renderNativeTranscriptItem = (item, props = {}) => {
    root.render(wrap(R.createElement(Auth.bgt.Provider, { value: { accountId: null, planAtLogin: null, requiresAuth: false, isAuthenticated: false, authMethod: null } }, R.createElement(Core.Clt, { scope: Native.e2t, value: { kind: "local", clientThreadId: "local:fixture", conversationId: "fixture", placement: "main", routeConversationId: "fixture", browserTabMentionConversationId: "fixture" } }, R.createElement(Transcript.D, {
      conversationId: "fixture", hostId: "local", turnId: "fixture-turn", cwd: "/fixture",
      conversationDetailLevel: "default", isReadOnly: true, isTurnInProgress: false,
      alwaysShowAssistantMessageActions: false, showAssistantMessageActionRow: false,
      loadRemoteToolLogos: false, renderMcpApps: false, resolvedApps: [],
      ...props, item,
    })))));
  };
  window.nativeTranscriptLoaded = true;
} catch (error) {
  window.nativeErrors.push(String(error.stack || error));
  document.getElementById("root").textContent = String(error);
}
