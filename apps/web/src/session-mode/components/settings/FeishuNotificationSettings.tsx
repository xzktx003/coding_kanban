import { useCallback, useEffect, useRef, useState } from "react";
import type {
  FeishuNotificationSettingsResponse,
  UpdateFeishuNotificationSettingsInput,
} from "@agent-orchestrator/shared";
import { Button } from "@session/components/ui/button";
import { Card, CardContent } from "@session/components/ui/card";
import { Switch } from "@session/components/ui/switch";
import {
  getFeishuNotificationSettings,
  updateFeishuNotificationSettings,
} from "../../../lib/api";

type UpdateIntent = UpdateFeishuNotificationSettingsInput | null;

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

  const updateSettings = useCallback(
    async (input: UpdateFeishuNotificationSettingsInput) => {
      setUpdating(true);
      setUpdateError(null);
      setLastUpdateIntent(input);
      try {
        const next = await updateFeishuNotificationSettings(input);
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
    },
    [],
  );

  const updateEnabled = useCallback(
    async (enabled: boolean) => {
      await updateSettings({ enabled });
    },
    [updateSettings],
  );

  const updateReplyEnabled = useCallback(
    async (replyEnabled: boolean) => {
      await updateSettings({ replyEnabled });
    },
    [updateSettings],
  );

  const retryUpdate = useCallback(() => {
    if (lastUpdateIntent !== null) {
      void updateSettings(lastUpdateIntent);
    }
  }, [lastUpdateIntent, updateSettings]);

  const disabled = loading || updating || !settings?.configured;
  const checked = Boolean(settings?.enabled);
  const replyDisabled = loading || updating || !settings?.replyConfigured;
  const replyChecked = Boolean(settings?.replyEnabled);

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
          <div className="mt-4 flex items-center justify-between gap-4 border-t pt-4">
            <div className="space-y-1">
              <div className="text-sm font-medium">飞书回复继续任务</div>
              <div className="text-xs text-muted-foreground">
                仅个人接收目标可用；回复会话模式的完成卡片可继续原 Codex
                会话，忙碌时会排队。
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{replyChecked ? "回复已开启" : "回复已关闭"}</span>
                <span>
                  {loading
                    ? "读取中"
                    : settings?.replyConfigured
                      ? "个人回复已配置"
                      : "个人回复未配置"}
                </span>
              </div>
            </div>
            <Switch
              aria-label="飞书回复继续任务"
              checked={replyChecked}
              disabled={replyDisabled}
              onCheckedChange={(replyEnabled) =>
                void updateReplyEnabled(replyEnabled)
              }
            />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
