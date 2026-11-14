import { lazy } from "react";

export const LazyNarrowTerminalView = lazy(() =>
  import("./NarrowTerminalView").then(({ NarrowTerminalView }) => ({
    default: NarrowTerminalView,
  })),
);
