import { mermaid } from "@streamdown/mermaid";
import type { DiagramPlugin } from "streamdown";

type LayoutDefinition =
  (typeof import("@mermaid-js/layout-elk"))["default"][number];
type Layout = Awaited<ReturnType<LayoutDefinition["loader"]>>;
type Instance = (typeof import("mermaid"))["default"];

const initialized = new WeakSet<Instance>();
let instance: Promise<Instance> | undefined;
let renders = Promise.resolve<unknown>(undefined);
let elk: Promise<Layout> | undefined;
const loadElk = () =>
  (elk ??= import("@mermaid-js/layout-elk").then(({ default: layouts }) => {
    const definition = layouts.find((layout) => layout.name === "elk");
    if (!definition) throw new Error("Missing native Mermaid ELK layout");
    return definition.loader();
  }));

// Original image-c74e0d7f2cfe.js ye(): ChatGPT's pure flowchart layout
// wrapper. The source B() isolates measurements from surrounding host CSS.
const flowchart: LayoutDefinition = {
  name: "chatgpt-flowchart",
  algorithm: "elk.layered",
  loader: async () => {
    const base = await loadElk();
    return {
      async render(data, svg, helpers, options) {
        for (const node of data.nodes) {
          if (node.isGroup) continue;
          if (
            ["diamond", "diam", "decision", "question"].includes(
              node.shape ?? "",
            )
          ) {
            node.shape = "rect";
            node.cssClasses = `${node.cssClasses ?? ""} mermaid-decision`;
          }
          if (
            [
              "rect",
              "squareRect",
              "proc",
              "process",
              "rectangle",
              "rounded",
              "roundedRect",
              "event",
            ].includes(node.shape ?? "")
          ) {
            node.shape = "rect";
            node.padding = 16;
            node.labelPaddingX = 36;
            node.height = Math.max(node.height ?? 0, 60);
          }
        }
        await base.render(
          data,
          svg,
          {
            ...helpers,
            insertEdge(element, edge, ...rest) {
              const points = edge.points ?? [];
              const shortened = points.map(
                (point: { x: number; y: number }) => ({ ...point }),
              );
              for (const [index, neighbor, arrow] of [
                [0, 1, edge.arrowTypeStart],
                [points.length - 1, points.length - 2, edge.arrowTypeEnd],
              ] as const) {
                const point = points[index],
                  next = points[neighbor];
                if (arrow !== "arrow_point" || !point || !next) continue;
                const dx = next.x - point.x,
                  dy = next.y - point.y;
                const length = Math.hypot(dx, dy);
                if (!length) continue;
                const inset = Math.min(8, Math.max(0, length / 2 - 4));
                shortened[index] = {
                  x: point.x + (dx / length) * inset,
                  y: point.y + (dy / length) * inset,
                };
              }
              return helpers.insertEdge(
                element,
                { ...edge, points: shortened },
                ...rest,
              );
            },
            async insertEdgeLabel(element, edge) {
              const label = await helpers.insertEdgeLabel(element, edge);
              const background =
                label.querySelector<SVGRectElement>("rect.background");
              const text = label.querySelector<SVGTextElement>("text");
              if (edge.label && background && text) {
                const bounds = text.getBBox();
                const height = Math.max(26, bounds.height + 8);
                background.setAttribute("x", String(bounds.x - 12));
                background.setAttribute(
                  "y",
                  String(bounds.y - (height - bounds.height) / 2),
                );
                background.setAttribute("width", String(bounds.width + 24));
                background.setAttribute("height", String(height));
                background.style.removeProperty("stroke");
                const box = label.getBBox();
                edge.width = box.width;
                edge.height = box.height;
                label.parentElement?.setAttribute(
                  "transform",
                  `translate(${-box.x - box.width / 2},${-box.y - box.height / 2})`,
                );
              }
              return label;
            },
          },
          options,
        );
        const diagonal = 4.5 / Math.SQRT2,
          inset = 4 - diagonal;
        svg
          .selectAll(
            'marker[id$="-pointEnd"], marker[id*="-pointEnd_"], marker[id$="-pointStart"], marker[id*="-pointStart_"]',
          )
          .attr("viewBox", "-5 -5 10 10")
          .attr("markerWidth", 10)
          .attr("markerHeight", 10)
          .attr("refX", 0)
          .attr("refY", 0)
          .selectAll("path")
          .style("fill", "none")
          .style("stroke-width", "1")
          .style("stroke-dasharray", "none")
          .style("stroke-linecap", "round")
          .style("stroke-linejoin", "round");
        svg
          .selectAll(
            'marker[id$="-pointEnd"] path, marker[id*="-pointEnd_"] path',
          )
          .attr(
            "d",
            `M 0 0 L 4 0 M ${inset} ${-diagonal} L 4 0 L ${inset} ${diagonal}`,
          );
        svg
          .selectAll(
            'marker[id$="-pointStart"] path, marker[id*="-pointStart_"] path',
          )
          .attr(
            "d",
            `M 0 0 L -4 0 M ${-inset} ${-diagonal} L -4 0 L ${-inset} ${diagonal}`,
          );
      },
    };
  },
};

function isolated(definition: LayoutDefinition): LayoutDefinition {
  return {
    ...definition,
    loader: async () => {
      const layout = await definition.loader();
      return {
        async render(data, svg, helpers, options) {
          const element = svg.node();
          if (!element?.parentElement)
            throw new Error("Missing Mermaid render container");
          const host = element.ownerDocument.createElement("div");
          // The original host inherits these flags from extension html. This
          // private body-level measurement tree sits outside our Codex scope.
          host.style.setProperty("font-synthesis-weight", "none");
          host.style.setProperty("-webkit-font-smoothing", "antialiased");
          element.parentElement.append(host);
          const shadow = host.attachShadow({ mode: "open" });
          shadow.append(element);
          try {
            await layout.render(
              data,
              svg.selectAll(function () {
                return [this];
              }),
              {
                ...helpers,
                insertMarkers(...args) {
                  helpers.insertMarkers(...args);
                  for (const marker of element.querySelectorAll("marker"))
                    host.append(marker.cloneNode(true));
                },
                insertEdge(...args) {
                  const result = helpers.insertEdge(...args);
                  for (const marker of host.querySelectorAll("marker")) {
                    if (!shadow.getElementById(marker.id))
                      element.append(marker.cloneNode(true));
                  }
                  return result;
                },
              },
              options,
            );
          } finally {
            host.before(element);
            host.remove();
          }
        },
      };
    },
  };
}

export const nativeMermaid: DiagramPlugin = {
  ...mermaid,
  getMermaid(config) {
    const facade = mermaid.getMermaid(config);
    return {
      initialize: facade.initialize,
      render(id, source) {
        // Streamdown exposes a render facade, not the underlying registry.
        // Both imports resolve the existing pinned Mermaid singleton. Keep the
        // original native render queue so two async SVGs do not race configs.
        const pending = renders.then(async () => {
          const engine = await (instance ??= import("mermaid").then(
            (module) => module.default,
          ));
          if (!initialized.has(engine)) {
            engine.registerLayoutLoaders([
              isolated(flowchart),
              isolated({
                name: "codex-elk",
                algorithm: "elk.layered",
                loader: loadElk,
              }),
            ]);
            initialized.add(engine);
          }
          if (config) facade.initialize(config);
          return facade.render(id, source);
        });
        renders = pending.then(
          () => undefined,
          () => undefined,
        );
        return pending;
      },
    };
  },
};
