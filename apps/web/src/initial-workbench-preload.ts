import { readWorkbenchMode } from "./lib/workbench-mode";
import { isPlanWindowRoute } from "./session-mode/features/thread-workflows/planSnapshot";
import {
  preloadSessionApp,
  preloadSessionWorkbench,
} from "./session-mode/sessionWorkbenchLoader";

// Fetch the selected session graph while the main React entry is downloading.
// Importing these modules does not mount the app or start its request effects.
if (!isPlanWindowRoute() && readWorkbenchMode() === "session") {
  void preloadSessionApp();
  preloadSessionWorkbench();
}
