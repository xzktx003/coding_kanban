import { useEffect, useState } from "react";
import { loadSessionApp } from "./sessionWorkbenchLoader";

type SessionAppModule = typeof import("./App");

type LoadState =
  | { status: "loading" }
  | { status: "loaded"; module: SessionAppModule }
  | { status: "error"; error: unknown };

export function SessionAppBody() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let mounted = true;
    // Publish the shared import through ordinary state. A new React.lazy
    // payload can suspend even after preloading, delaying the first App commit.
    void loadSessionApp().then(
      (module) => {
        if (mounted) setState({ status: "loaded", module });
      },
      (error: unknown) => {
        if (mounted) setState({ status: "error", error });
      },
    );
    return () => {
      mounted = false;
    };
  }, []);

  if (state.status === "error") throw state.error;
  if (state.status === "loading") {
    return (
      <div className="session-app-loading" role="status">
        正在准备会话内容…
      </div>
    );
  }
  const App = state.module.default;
  return <App />;
}
