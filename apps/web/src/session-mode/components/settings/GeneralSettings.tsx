import { useFollowupSettingsStore, type EnterBehavior } from "@session/stores/useFollowupSettingsStore";
import { PROJECT_REPOSITORY_URL } from "../../../lib/product-links";
import { Monitor, Moon, Sun, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import githubIcon from "@session/assets/github.svg";
import { Button } from "@session/components/ui/button";
import { Card, CardContent } from "@session/components/ui/card";
import { Input } from "@session/components/ui/input";
import { Switch } from "@session/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@session/components/ui/tabs";
import {
  getTelemetryStatus,
  setTelemetryConsent,
  type TelemetryStatus,
} from "@session/lib/telemetry";
import { cn } from "@session/lib/utils";
import {
  type Accent,
  type Theme,
  useThemeStore,
} from "@session/stores/settings";
import { LanguageSelector } from "./LanguageSelector";

const ACCENT_OPTIONS: Array<{
  value: Accent;
  label: string;
  colorClass: string;
}> = [
  { value: "default", label: "Default", colorClass: "bg-neutral-500" },
  { value: "ghibli", label: "Ghibli", colorClass: "bg-emerald-700" },
  { value: "black", label: "Noir", colorClass: "bg-slate-800" },
  { value: "pink", label: "Pink", colorClass: "bg-pink-500" },
  { value: "blue", label: "Blue", colorClass: "bg-blue-500" },
  { value: "green", label: "Green", colorClass: "bg-emerald-500" },
  { value: "purple", label: "Purple", colorClass: "bg-purple-500" },
  { value: "orange", label: "Orange", colorClass: "bg-orange-500" },
];

export function GeneralSettings() {
  const followup = useFollowupSettingsStore();
  const {
    theme,
    setTheme,
    accent,
    setAccent,
    starfield,
    setStarfield,
    backgroundImage,
    setBackgroundImage,
  } = useThemeStore();
  const handleThemeChange = (value: string) => setTheme(value as Theme);
  const { t } = useTranslation("settings");
  const [telemetry, setTelemetry] = useState<TelemetryStatus | null>(null);
  useEffect(() => {
    getTelemetryStatus()
      .then(setTelemetry)
      .catch(() => {});
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAccentSelect = (value: Accent) => {
    setAccent(value);
    // Noir looks flat without it, so switch the starfield on by default.
    if (value === "black" && !starfield) setStarfield(true);
  };

  const handleBackgroundFile = (file: File | null | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setBackgroundImage(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  // Shared Tailwind classes from shadcn/ui Button (variant: default, size: sm)
  const buttonClassName =
    "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground shadow hover:bg-primary/90 h-9 px-3";

  return (
    <div className="space-y-6">
      <section className="session-followup-preferences"><h3>消息发送与审查</h3>
        <label>运行中默认发送方式<select aria-label="默认追加消息方式" value={followup.mode} onChange={e=>followup.setMode(e.target.value as "queue"|"steer")}><option value="queue">排队，当前轮结束后发送</option><option value="steer">引导当前任务</option></select></label>
        <label>Enter 行为<select aria-label="Enter 发送行为" value={followup.enterBehavior} onChange={e=>followup.setEnterBehavior(e.target.value as EnterBehavior)}><option value="enter">Enter 发送</option><option value="cmdIfMultiline">多行时 Ctrl/Cmd+Enter 发送</option><option value="cmdAlways">始终 Ctrl/Cmd+Enter 发送</option></select></label>
        <p>Shift+Enter 换行；运行中 Ctrl/Cmd+Shift+Enter 临时切换排队与引导。</p>
        <label>默认审查方式<select aria-label="默认审查方式" value={followup.reviewDelivery} onChange={e=>followup.setReviewDelivery(e.target.value as "inline"|"detached")}><option value="inline">当前会话</option><option value="detached">独立会话</option></select></label>
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-medium px-1">{t("preferences")}</h3>
        <Card>
          <CardContent className="px-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">{t("appearance")}</div>
                <div className="text-xs text-muted-foreground">
                  {t("appearanceDescription")}
                </div>
              </div>
              <Tabs value={theme} onValueChange={handleThemeChange}>
                <TabsList className="h-8">
                  <TabsTrigger value="light" className="px-3 gap-2 text-xs">
                    <Sun className="h-3.5 w-3.5" />
                    {t("light")}
                  </TabsTrigger>
                  <TabsTrigger value="dark" className="px-3 gap-2 text-xs">
                    <Moon className="h-3.5 w-3.5" />
                    {t("dark")}
                  </TabsTrigger>
                  <TabsTrigger value="system" className="px-3 gap-2 text-xs">
                    <Monitor className="h-3.5 w-3.5" />
                    {t("system")}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="h-px bg-border" />
            <div className="space-y-2">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">{t("accentColor")}</div>
                <div className="text-xs text-muted-foreground">
                  {t("accentColorDescription")}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {ACCENT_OPTIONS.map(({ value, label, colorClass }) => {
                  const selected = accent === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => handleAccentSelect(value)}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs transition-colors",
                        "hover:bg-accent/60 hover:text-accent-foreground",
                        selected
                          ? "border-primary bg-accent text-accent-foreground"
                          : "border-border text-foreground",
                      )}
                      aria-pressed={selected}
                      aria-label={`Use ${label} accent color`}
                    >
                      <span
                        className={cn("size-2.5 rounded-full", colorClass)}
                      />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="h-px bg-border" />
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">{t("starfield")}</div>
                <div className="text-xs text-muted-foreground">
                  {t("starfieldDescription")}
                </div>
              </div>
              <Switch checked={starfield} onCheckedChange={setStarfield} />
            </div>
            <div className="space-y-2">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">
                  {t("backgroundImage")}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t("backgroundImageDescription")}
                </div>
              </div>
              <div className="flex gap-2">
                <Input
                  type="url"
                  placeholder="https://..."
                  value={
                    backgroundImage?.startsWith("data:")
                      ? ""
                      : (backgroundImage ?? "")
                  }
                  onChange={(e) => setBackgroundImage(e.target.value || null)}
                  className="h-8 text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {t("uploadImage")}
                </Button>
                {backgroundImage && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => setBackgroundImage(null)}
                    aria-label={t("clearBackgroundImage")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleBackgroundFile(e.target.files?.[0])}
                />
              </div>
            </div>
            <div className="h-px bg-border" />
            <LanguageSelector />
          </CardContent>
        </Card>
      </section>
      {telemetry?.available && (
        <section className="space-y-3">
          <h3 className="text-sm font-medium px-1">{t("telemetrySection")}</h3>
          <Card>
            <CardContent className="px-4">
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">
                    {t("telemetryToggle")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("telemetryToggleDescription")}
                  </div>
                </div>
                <Switch
                  checked={telemetry?.consent === "granted"}
                  onCheckedChange={(on) => {
                    setTelemetryConsent(on ? "granted" : "denied")
                      .then(setTelemetry)
                      .catch(() => {});
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </section>
      )}
      <section className="space-y-3">
        <h3 className="text-sm font-medium px-1">当前项目</h3>
        <div className="flex flex-wrap gap-2 text-balance">
          <a
            aria-label="GitHub 项目"
            href={PROJECT_REPOSITORY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClassName}
          >
            <img src={githubIcon} alt="" className="h-4 w-4" />
            <span>GitHub 项目</span>
          </a>
        </div>
      </section>
    </div>
  );
}
