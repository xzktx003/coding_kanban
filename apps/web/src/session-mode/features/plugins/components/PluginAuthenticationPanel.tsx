import { Button } from "@session/components/ui/button";
import { usePluginsViewContext } from "../hooks";
export function PluginAuthenticationPanel() {
  const {
    authentication,
    setAuthentication,
    authenticationBusy,
    checkAuthentication,
    openAuthentication,
  } = usePluginsViewContext();
  if (!authentication) return null;
  return (
    <section
      aria-label={`${authentication.name} 插件认证`}
      className="shrink-0 space-y-2 border-b border-border bg-muted/30 p-3 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{authentication.name} · 应用认证</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAuthentication(null)}
        >
          收起认证入口
        </Button>
      </div>
      <p className="text-muted-foreground">
        逐项打开官方认证页面，完成后核对。打开页面本身不会被记为认证成功。
      </p>
      <div className="flex flex-wrap gap-2">
        {authentication.apps.map((app) => (
          <Button
            key={app.id}
            className="session-plugin-touch-target"
            size="sm"
            variant="outline"
            disabled={!app.installUrl || app.isAccessible === true}
            onClick={() => void openAuthentication(app)}
          >
            {app.isAccessible === true
              ? `${app.name} 已可用`
              : `认证 ${app.name}`}
          </Button>
        ))}
      </div>
      {authentication.apps.some((app) => app.isAccessible === false) && (
        <p>仍有应用尚不可用，请完成对应认证后再次核对。</p>
      )}
      {authentication.apps.some((app) => app.isAccessible === null) && (
        <p>部分应用尚未从当前原生目录核实，请稍后重试。</p>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={authenticationBusy}
        onClick={() => void checkAuthentication()}
      >
        {authenticationBusy ? "正在核对…" : "核对认证状态"}
      </Button>
    </section>
  );
}
