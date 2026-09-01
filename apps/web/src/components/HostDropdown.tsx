import { useEffect, useRef, useState } from "react";

import type { SshHostPreset } from "@agent-orchestrator/shared";

export type SelectedHost =
  | { type: "local" }
  | { type: "ssh"; preset: SshHostPreset };

export type NewSessionHost = SelectedHost | { type: "ssh-manual" };

export type HostDropdownOption =
  | {
      kind: "host";
      host: SelectedHost;
      label: string;
      detail?: string;
      icon: string;
    }
  | {
      kind: "manual-ssh";
      label: string;
      detail: string;
      icon: string;
    };

export function buildHostDropdownOptions(
  sshHosts: SshHostPreset[],
  allowManualSsh: boolean,
): HostDropdownOption[] {
  return [
    {
      kind: "host",
      host: { type: "local" },
      label: "本机",
      icon: "🖥",
    },
    ...sshHosts.map((preset) => ({
      kind: "host" as const,
      host: { type: "ssh" as const, preset },
      label: preset.name,
      detail: `${preset.username ? `${preset.username}@` : ""}${preset.host}`,
      icon: "🌐",
    })),
    ...(allowManualSsh
      ? [
          {
            kind: "manual-ssh" as const,
            label: "新增 SSH 连接",
            detail: "输入主机、端口和用户名",
            icon: "＋",
          },
        ]
      : []),
  ];
}

interface HostDropdownProps {
  sshHosts: SshHostPreset[];
  onSelectHost: (host: SelectedHost) => void;
  onSelectManualSsh?: () => void;
  triggerLabel: string;
  disabled?: boolean;
  buttonTestId?: string;
  menuTestId?: string;
  menuAlign?: "start" | "end";
  triggerClassName?: string;
}

export function HostDropdown({
  sshHosts,
  onSelectHost,
  onSelectManualSsh,
  triggerLabel,
  disabled,
  buttonTestId,
  menuTestId,
  menuAlign = "start",
  triggerClassName,
}: HostDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="host-dropdown" ref={ref}>
      <button
        className={triggerClassName ?? "top-bar-action"}
        onClick={() => setOpen(!open)}
        disabled={disabled}
        data-testid={buttonTestId ?? `btn-${triggerLabel}`}
        type="button"
      >
        {triggerLabel} ▾
      </button>
      {open && (
        <div
          className={`host-dropdown-menu${menuAlign === "end" ? " host-dropdown-menu--end" : ""}`}
          data-testid={menuTestId ?? "host-dropdown-menu"}
        >
          {buildHostDropdownOptions(sshHosts, Boolean(onSelectManualSsh)).map(
            (option) => (
              <button
                key={`${option.kind}:${option.label}`}
                className="host-dropdown-item"
                onClick={() => {
                  if (option.kind === "manual-ssh") {
                    onSelectManualSsh?.();
                  } else {
                    onSelectHost(option.host);
                  }
                  setOpen(false);
                }}
                type="button"
              >
                <span className="host-dropdown-name">
                  {option.icon} {option.label}
                </span>
                {option.detail && (
                  <span className="host-dropdown-detail">{option.detail}</span>
                )}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
