import { useCallback, useEffect, useRef, useState } from "react";
import type { FeishuNotificationSettingsResponse } from "@agent-orchestrator/shared";
import { Button } from "@session/components/ui/button";
import { Card, CardContent } from "@session/components/ui/card";
import { Switch } from "@session/components/ui/switch";
import {
  getFeishuNotificationSettings,
  updateFeishuNotificationSettings,
} from "../../../lib/api";

type UpdateIntent = boolean | null;

function destinationLabel(
  settings: FeishuNotificationSettingsResponse | null,
): string {
  if (!settings?.configured) return "未配置接收目标";
  if (settings.destinationType === "chat") return "目标：群聊";
  if (settings.destinationType === "user") return "目标：个人";
  return "目标：已配置";
}

export function FeishuNotificationSettings() {
  const [settings, setSettings] =
    useState<FeishuNotificationSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [lastUpdateIntent, setLastUpdateIntent] = useState<UpdateIntent>(null);
  const mountedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const next = await getFeishuNotificationSettings();
      if (!mountedRef.current) return;
      setSettings(next);
    } catch {
      if (!mountedRef.current) return;
      setLoadError("无法读取飞书完成通知设置");
    } finally {
      if (!mountedRef.current) return;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  const updateEnabled = useCallback(async (enabled: boolean) => {
    setUpdating(true);
    setUpdateError(null);
    setLastUpdateIntent(enabled);
    try {
      const next = await updateFeishuNotificationSettings({ enabled });
      if (!mountedRef.current) return;
      setSettings(next);
      setLastUpdateIntent(null);
    } catch {
      if (!mountedRef.current) return;
      setUpdateError("无法更新飞书完成通知设置");
    } finally {
      if (!mountedRef.current) return;
      setUpdating(false);
    }
  }, []);

  const retryUpdate = useCallback(() => {
    if (lastUpdateIntent !== null) {
      void updateEnabled(lastUpdateIntent);
    }
  }, [lastUpdateIntent, updateEnabled]);

  const disabled = loading || updating || !settings?.configured;
  const checked = Boolean(settings?.enabled);

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium px-1">飞书完成通知</h3>
      <Card>
        <CardContent className="px-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-sm font-medium">Codex 完成通知</div>
              <div className="text-xs text-muted-foreground">
                与终端共用开关；Codex 每轮成功完成后发送，关闭页面也可通知。
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  {loading ? "读取中" : checked ? "已开启" : "已关闭"}
                </span>
                <span>{destinationLabel(settings)}</span>
              </div>
              {loadError && (
                <div className="flex items-center gap-2 text-xs text-destructive">
                  <span>{loadError}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => void load()}
                    aria-label="重试读取飞书通知设置"
                  >
                    重试
                  </Button>
                </div>
              )}
              {updateError && (
                <div className="flex items-center gap-2 text-xs text-destructive">
                  <span>{updateError}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={retryUpdate}
                    aria-label="重试更新飞书通知设置"
                  >
                    重试
                  </Button>
                </div>
              )}
            </div>
            <Switch
              aria-label="飞书完成通知"
              checked={checked}
              disabled={disabled}
              onCheckedChange={(enabled) => void updateEnabled(enabled)}
            />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
