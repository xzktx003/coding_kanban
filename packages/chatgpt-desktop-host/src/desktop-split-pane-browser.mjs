// Imported by the pinned original page, inside its existing React root. The
// thread/route/composer values are captured from the real committed scopes;
// opaque presentation keys never become native IDs or RPC authority.
import {
  pWt as getReact,
  JFt as getJsx,
  fTt as NativeScope,
  oTt as useScope,
  Jwt as useLocation,
  lTt as useNativeAtom,
  klt as RootScope,
} from "../assets/app-shared-601019a330d7.js";
import {
  B5n as ThreadScope,
  p5n as RouteScope,
  w6n as ComposerScope,
  UKn as ConversationRecordAtom,
  uXt as ConversationTitleAtom,
  bEn as navigateToLocalConversation,
} from "../assets/app-initial-18b189e867e7.js";
import { createDesktopSplitPaneRuntime } from "./desktop-split-pane-core.mjs";
import { readDesktopLayoutConfig } from "./desktop-layout-core.mjs";
import * as layout from "./desktop-layout-browser.mjs";

const jsx = getJsx();
const React = getReact();
let transcriptImport;
function PassiveTranscript(props) {
  const [state, setState] = React.useState(null);
  React.useEffect(() => {
    let current = true;
    transcriptImport ??=
      import("../assets/local-conversation-thread-2f594f841b07.js").then(
        (module) => {
          if (typeof module.n !== "function")
            throw Error("Original transcript unavailable");
          return module.n;
        },
      );
    void transcriptImport.then(
      (component) => {
        if (current) setState({ component });
      },
      () => {
        if (current) setState({ failed: true });
      },
    );
    return () => {
      current = false;
    };
  }, []);
  return state?.component
    ? jsx.jsx(state.component, props)
    : jsx.jsx("div", {
        children: state?.failed ? "无法加载会话内容" : "正在加载会话",
      });
}
function useNativeContext() {
  return {
    thread: useScope(ThreadScope).value,
    route: useScope(RouteScope).value,
    composer: useScope(ComposerScope).value,
  };
}
function useNativeTitle(scope) {
  // The original Bl header reads these same atoms keyed by conversationId.
  // This is display metadata only; the separately committed scope is still
  // the sole source of the input target and navigation identity.
  const explicit = useNativeAtom(ConversationTitleAtom, scope.conversationId);
  const record = useNativeAtom(ConversationRecordAtom, scope.conversationId);
  const descriptor = record && typeof record === "object"
    ? Object.getOwnPropertyDescriptor(record, "displayTitle")
    : undefined;
  const displayTitle = descriptor && Object.hasOwn(descriptor, "value")
    ? descriptor.value
    : null;
  return explicit ?? displayTitle;
}
function useNavigationContext() {
  const rootScope = useScope(RootScope);
  const location = useLocation();
  let marker = null;
  if (location.state !== null && typeof location.state === "object") {
    const descriptor = Object.getOwnPropertyDescriptor(
      location.state,
      "__chatgptDesktopPaneNavigation",
    );
    if (descriptor)
      marker = Object.hasOwn(descriptor, "value") ? descriptor.value : false;
  }
  return {
    pathname: location.pathname,
    search: location.search,
    marker,
    activateTarget({ event, scope, state, isCurrent }) {
      const navigation = globalThis.window?.__kanbanSharedThreadNavigation;
      if (!navigation || typeof navigation.activateExplicit !== "function")
        return false;
      return navigation.activateExplicit({
        event: event.nativeEvent,
        hostId: scope.hostId,
        threadId: scope.conversationId,
        state,
        isCurrent,
        navigate(threadId, hostId, options) {
          return navigateToLocalConversation(
            rootScope,
            threadId,
            hostId === "local" ? undefined : hostId,
            options,
          );
        },
      });
    },
  };
}
function renderProviders(context, children) {
  return jsx.jsx(NativeScope, {
    scope: ThreadScope,
    value: context.thread,
    children: jsx.jsx(NativeScope, {
      scope: RouteScope,
      value: context.route,
      children: jsx.jsx(NativeScope, {
        scope: ComposerScope,
        value: context.composer,
        children,
      }),
    }),
  });
}
const runtime = createDesktopSplitPaneRuntime({
  React,
  jsx,
  enabled: readDesktopLayoutConfig().enabled,
  useNativeContext,
  useNativeTitle,
  useNavigationContext,
  renderProviders,
  PassiveTranscript,
  layoutRuntime: {
    DesktopLayoutBoundary: layout.DesktopLayoutBoundary,
    DesktopPaneOwnershipProvider: layout.DesktopPaneOwnershipProvider,
    footerOwnership: layout.desktopFooterOwnership,
    renderLayout: layout.renderDesktopLayout,
  },
});
export const DesktopSplitPaneBoundary = runtime.DesktopSplitPaneBoundary;
export const desktopSplitPaneRegistry = runtime.registry;
