import { PluginsViewProvider } from "../hooks/PluginsViewContext";
import { PluginsViewBottomBar } from "./PluginsViewBottomBar";
import { PluginsViewContent } from "./PluginsViewContent";
import { PluginsViewHeader } from "./PluginsViewHeader";
import "./plugin-touch.css";

export default function PluginsView() {
  return (
    <PluginsViewProvider>
      <div className="session-plugin-view flex h-full min-h-0 flex-col">
        <PluginsViewHeader />
        <PluginsViewContent />
        <PluginsViewBottomBar />
      </div>
    </PluginsViewProvider>
  );
}
