interface FrameConfig {
  nonce: string;
  theme: Record<string, string>;
  icons: Record<string, string>;
}
// This function is serialized into the opaque sandbox. Keep it self-contained.
function frameRuntime(config: FrameConfig) {
  const host = window as typeof window & {
    lucide?: {
      createIcons: (options?: {
        attrs?: Record<string, string | number>;
      }) => void;
    };
    openai?: { widgetState: unknown; setWidgetState: (value: unknown) => void };
    Tweak?: unknown;
  };
  const send = (type: string, data: Record<string, unknown>) =>
    parent.postMessage({ type, nonce: config.nonce, ...data }, "*");
  for (const [key, value] of Object.entries(config.theme))
    document.documentElement.style.setProperty(key, value);
  document.documentElement.dataset.theme = config.theme["color-scheme"];
  host.openai = {
    widgetState: {},
    setWidgetState(value) {
      this.widgetState = value;
    },
  };
  host.lucide = {
    createIcons(options) {
      for (const placeholder of document.querySelectorAll<HTMLElement>(
        "[data-lucide]",
      )) {
        const markup = config.icons[placeholder.dataset.lucide ?? ""];
        if (!markup) continue;
        const box = document.createElement("span");
        box.innerHTML = markup;
        const svg = box.firstElementChild;
        if (!svg) continue;
        svg.setAttribute("aria-hidden", "true");
        for (const [key, value] of Object.entries(options?.attrs ?? {}))
          svg.setAttribute(key, String(value));
        placeholder.replaceChildren(svg);
      }
    },
  };
  class Tweak {
    element: HTMLElement;
    change: () => void;
    constructor(options: { container: HTMLElement; onChange?: () => void }) {
      this.change = options.onChange ?? (() => {});
      const details = document.createElement("details");
      details.className = "viz-tweak";
      const summary = document.createElement("summary");
      summary.textContent = "演示设置";
      details.append(summary);
      options.container.append(details);
      this.element = details;
    }
    addToggle(
      target: Record<string, unknown>,
      key: string,
      options: { label?: string } = {},
    ) {
      const label = document.createElement("label"),
        input = document.createElement("input");
      input.type = "checkbox";
      input.checked = Boolean(target[key]);
      input.addEventListener("change", () => {
        target[key] = input.checked;
        this.change();
      });
      label.append(input, document.createTextNode(options.label ?? key));
      this.element.append(label);
      return this;
    }
  }
  host.Tweak = Tweak;
  const initialize = () => {
    host.lucide?.createIcons();
    const tooltip = document.createElement("div");
    tooltip.className = "viz-tooltip";
    tooltip.setAttribute("role", "tooltip");
    tooltip.hidden = true;
    document.body.append(tooltip);
    const showTooltip = (event: Event) => {
      const target = (event.target as Element)?.closest<HTMLElement>(
        "[data-tooltip]",
      );
      if (!target) return;
      tooltip.textContent = target.dataset.tooltip ?? "";
      tooltip.hidden = false;
      const box = target.getBoundingClientRect();
      tooltip.style.left = `${Math.max(4, Math.min(box.left, innerWidth - tooltip.offsetWidth - 4))}px`;
      tooltip.style.top = `${Math.max(4, box.top - tooltip.offsetHeight - 4)}px`;
    };
    document.addEventListener("pointerover", showTooltip);
    document.addEventListener("focusin", showTooltip);
    for (const type of ["pointerout", "focusout", "click", "keydown"])
      document.addEventListener(type, () => {
        tooltip.hidden = true;
      });
    for (const carousel of document.querySelectorAll<HTMLElement>(
      ".viz-carousel",
    )) {
      const panels = Array.from(carousel.children).filter(
        (child): child is HTMLElement =>
          child instanceof HTMLElement && child.hasAttribute("data-variant"),
      );
      if (panels.length < 2) continue;
      const controls = document.createElement("div");
      controls.className = "viz-carousel-controls";
      controls.setAttribute("role", "tablist");
      controls.setAttribute(
        "aria-label",
        carousel.getAttribute("aria-label") ?? "切换预览",
      );
      const buttons = panels.map((panel, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "tab");
        button.textContent = panel.dataset.variant ?? String(index + 1);
        button.addEventListener("click", () => select(index));
        controls.append(button);
        return button;
      });
      const select = (index: number) => {
        panels.forEach((panel, i) => {
          panel.hidden = i !== index;
          buttons[i].setAttribute("aria-selected", String(i === index));
        });
      };
      carousel.prepend(controls);
      select(
        Math.max(
          0,
          panels.findIndex((panel) => !panel.hidden),
        ),
      );
    }
    let frame = 0;
    const resize = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        send("session-visualization-size", {
          height: Math.ceil(document.body.getBoundingClientRect().height),
        }),
      );
    };
    new ResizeObserver(resize).observe(document.body);
    resize();
  };
  window.addEventListener("error", (event) =>
    send("session-visualization-error", {
      message: event.message.slice(0, 300),
    }),
  );
  window.addEventListener("unhandledrejection", (event) =>
    send("session-visualization-error", {
      message: String(
        event.reason instanceof Error ? event.reason.message : event.reason,
      ).slice(0, 300),
    }),
  );
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
}
const resources =
  "https://cdnjs.cloudflare.com https://esm.sh https://cdn.jsdelivr.net https://unpkg.com https://fonts.googleapis.com https://fonts.gstatic.com https://fonts.bunny.net";
const csp = `default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' ${resources}; style-src 'unsafe-inline' ${resources}; img-src data: blob: ${resources}; font-src data: ${resources}; media-src data: blob: ${resources}; worker-src blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
const css = `html,body{margin:0;min-width:0}body{color:var(--foreground);background:var(--background);font:14px/1.5 system-ui,sans-serif}*{box-sizing:border-box}button,input,select,textarea{font:inherit}.viz-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr));gap:16px}.viz-row,.viz-controls,.viz-carousel-controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.viz-carousel-controls{padding:8px 0}.viz-carousel-controls button,.btn,.nav-link{padding:6px 12px;border:1px solid var(--border);border-radius:6px;background:var(--secondary,var(--background));color:var(--foreground);cursor:pointer}.viz-carousel-controls [aria-selected=true],.btn-primary,.nav-link.active{background:var(--primary);color:var(--primary-foreground)}.viz-carousel>[hidden]{display:none!important}.viz-dotted-background{background-image:radial-gradient(var(--border) 1px,transparent 1px);background-size:16px 16px}.text-muted{color:var(--muted-foreground)}.card{padding:16px;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--card-foreground)}.viz-stat-value{font-size:28px}.form-control,.form-select{width:100%;padding:6px;color:var(--foreground);background:var(--background);border:1px solid var(--border);border-radius:4px}.form-check{display:flex;align-items:center;gap:8px}.table{border-collapse:collapse;width:100%}.table td,.table th{padding:6px;text-align:left;border-bottom:1px solid var(--border)}.viz-tweak{position:absolute;bottom:4px;right:4px;z-index:9;padding:4px 8px;background:var(--popover,var(--background));color:var(--foreground);border:1px solid var(--border);border-radius:4px}.viz-tweak label{display:flex;align-items:center;gap:6px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0)}`;
const compatibilityCss = `body{--color-background-primary:var(--background);--color-background-secondary:var(--secondary);--color-text-primary:var(--foreground);--color-text-secondary:var(--muted-foreground);--color-border-secondary:var(--border);--color-text-inverse:var(--primary-foreground);--color-text-info:var(--primary);--color-text-warning:var(--destructive);--viz-bg:var(--background);--viz-text:var(--foreground);--viz-muted:var(--muted-foreground);--viz-border:var(--border);--viz-accent:var(--primary);--viz-accent-text:var(--primary-foreground)}.viz-tooltip{position:fixed;z-index:10000;max-width:240px;padding:4px 8px;border:1px solid var(--border);border-radius:4px;background:var(--popover);color:var(--popover-foreground);font-size:12px;pointer-events:none}[hidden]{display:none!important}`;
export function buildVisualizationDocument(
  content: string,
  config: FrameConfig,
): string {
  const data = JSON.stringify(config).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><style>${css}${compatibilityCss}</style><script>(${frameRuntime.toString()})(${data});</script></head><body>${content}</body></html>`;
}
