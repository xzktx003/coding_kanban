import { PluginsViewProvider } from "../hooks/PluginsViewContext";
import { PluginsViewBottomBar } from "./PluginsViewBottomBar";
import { PluginsViewContent } from "./PluginsViewContent";
import { PluginsViewHeader } from "./PluginsViewHeader";

export default function PluginsView() {
  return (
    <PluginsViewProvider>
      <div className="flex h-full min-h-0 flex-col">
        <PluginsViewHeader />
        <PluginsViewContent />
        <PluginsViewBottomBar />
      </div>
    </PluginsViewProvider>
  );
}
