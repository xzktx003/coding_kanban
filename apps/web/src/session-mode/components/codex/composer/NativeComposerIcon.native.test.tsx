import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { NativeComposerIcon } from "./NativeComposerIcon";

afterEach(cleanup);

// Fixed original native assets, independent of the component's private lookup.
const CHEVRON = {
  nativeName: "chevron-down-sm-light-16",
  viewBox: "0 0 16 16",
  paths: [
    "M10.2954 6.54537C10.5003 6.3404 10.8325 6.34051 11.0376 6.54537C11.2426 6.7504 11.2426 7.08253 11.0376 7.28756L8.60689 9.71822C8.27169 10.0534 7.72823 10.0534 7.39303 9.71822L4.96236 7.28756C4.75734 7.08253 4.75734 6.7504 4.96236 6.54537C5.16739 6.34035 5.49952 6.34035 5.70455 6.54537L7.99947 8.84029L10.2954 6.54537Z",
  ],
} as const;

const EXPAND = {
  nativeName: "arrow-up-right-arrow-down-left-sm-light-20",
  viewBox: "0 0 20 20",
  paths: [
    "M7.89136 11.1846C8.15092 10.925 8.57303 10.9253 8.83276 11.1846C9.09222 11.4442 9.09206 11.8653 8.83276 12.125L5.78491 15.1729H8.32886C8.69607 15.1729 8.99383 15.4707 8.9939 15.8379C8.9939 16.2051 8.69611 16.5029 8.32886 16.5029H4.2644C3.84223 16.5027 3.49997 16.1605 3.49976 15.7383V11.6748C3.49992 11.3077 3.79765 11.0098 4.16479 11.0098C4.53194 11.0098 4.82967 11.3077 4.82983 11.6748V14.2461L7.89136 11.1846Z",
    "M15.7351 3.50488C16.1573 3.50512 16.4995 3.84736 16.4998 4.26953V8.33301C16.4997 8.70018 16.2019 8.99802 15.8347 8.99805C15.4677 8.9978 15.1698 8.70004 15.1697 8.33301V5.76172L12.1082 8.82324C11.8485 9.08279 11.4264 9.08277 11.1667 8.82324C10.9073 8.56369 10.9076 8.14251 11.1667 7.88281L14.2146 4.83496H11.6707C11.3036 4.83472 11.0056 4.53704 11.0056 4.16992C11.0056 3.8028 11.3036 3.50512 11.6707 3.50488H15.7351Z",
  ],
} as const;

type FixedAsset = {
  nativeName: string;
  viewBox: string;
  paths: readonly string[];
};

function rootSVG(container: HTMLElement) {
  expect(container.querySelectorAll("svg")).toHaveLength(1);
  const svg = container.querySelector<SVGSVGElement>("svg");
  if (svg === null) throw new Error("The real NativeComposerIcon SVG is missing");
  expect(svg.isConnected).toBe(true);
  expect(svg.namespaceURI).toBe("http://www.w3.org/2000/svg");
  return svg;
}

function expectFixedAsset(svg: SVGSVGElement, asset: FixedAsset) {
  expect(svg.getAttribute("viewBox")).toBe(asset.viewBox);
  expect(svg.getAttribute("data-native-icon")).toBe(asset.nativeName);
  expect(svg.getAttribute("fill")).toBe("none");
  expect(svg.getAttribute("aria-hidden")).toBe("true");
  expect(svg.childNodes).toHaveLength(asset.paths.length);
  expect(svg.children).toHaveLength(asset.paths.length);
  Array.from(svg.children).forEach((path, index) => {
    expect(path.localName).toBe("path");
    expect(path.namespaceURI).toBe("http://www.w3.org/2000/svg");
    expect(path.parentNode).toBe(svg);
    expect(path.isConnected).toBe(true);
    expect(path.childNodes).toHaveLength(0);
    expect(
      Object.fromEntries(
        Array.from(path.attributes, (attribute) => [attribute.name, attribute.value]),
      ),
    ).toEqual({ d: asset.paths[index], fill: "currentColor" });
  });
}

function expectSVGProps(
  svg: SVGSVGElement,
  expected: { className: string; width: number; height: number; opacity: number; label: string },
) {
  expect(svg.getAttribute("class")).toBe(expected.className);
  expect(svg.getAttribute("width")).toBe(String(expected.width));
  expect(svg.getAttribute("height")).toBe(String(expected.height));
  expect(svg.style.opacity).toBe(String(expected.opacity));
  expect(svg.getAttribute("aria-label")).toBe(expected.label);
}

function expectChildIdentity(label: string, before: readonly Node[], after: readonly Node[]) {
  expect.soft(after.length, `${label}: every child remains present`).toBe(before.length);
  before.forEach((node, index) => {
    expect.soft(after[index], `${label}: childNode ${index} retains its native DOM identity`).toBe(node);
  });
}

it("preserves every native child node for unchanged-name same-props and real SVG-props rerenders", () => {
  const initialProps = {
    className: "native-icon-start",
    width: 16,
    height: 16,
    style: { opacity: 1 },
    "aria-label": "固定图标",
  };
  const mount = render(<NativeComposerIcon name="chevron" {...initialProps} />);
  const svg = rootSVG(mount.container);
  expectFixedAsset(svg, CHEVRON);
  expectSVGProps(svg, { className: "native-icon-start", width: 16, height: 16, opacity: 1, label: "固定图标" });
  const initialChildren = Array.from(svg.childNodes);

  mount.rerender(<NativeComposerIcon name="chevron" {...initialProps} />);
  expect(rootSVG(mount.container)).toBe(svg);
  expectFixedAsset(svg, CHEVRON);
  expectSVGProps(svg, { className: "native-icon-start", width: 16, height: 16, opacity: 1, label: "固定图标" });
  const samePropsChildren = Array.from(svg.childNodes);

  mount.rerender(
    <NativeComposerIcon
      name="chevron"
      className="native-icon-updated"
      width={24}
      height={20}
      style={{ opacity: 0.6 }}
      aria-label="更新图标"
    />,
  );
  expect(rootSVG(mount.container)).toBe(svg);
  expectFixedAsset(svg, CHEVRON);
  expectSVGProps(svg, { className: "native-icon-updated", width: 24, height: 20, opacity: 0.6, label: "更新图标" });
  const updatedPropsChildren = Array.from(svg.childNodes);

  // All asset, root and real-prop controls run before the identity RED targets.
  expectChildIdentity("same name and same props", initialChildren, samePropsChildren);
  expectChildIdentity("same name and changed SVG props", samePropsChildren, updatedPropsChildren);
});

it("updates fixed native bodies when the name changes and keeps each new body's child nodes on later SVG-props updates", () => {
  const initialProps = {
    className: "native-icon-cycle",
    width: 16,
    height: 16,
    style: { opacity: 1 },
    "aria-label": "循环图标",
  };
  const mount = render(<NativeComposerIcon name="chevron" {...initialProps} />);
  const svg = rootSVG(mount.container);
  expectFixedAsset(svg, CHEVRON);
  expectSVGProps(svg, { className: "native-icon-cycle", width: 16, height: 16, opacity: 1, label: "循环图标" });

  mount.rerender(<NativeComposerIcon name="expand" {...initialProps} />);
  expect(rootSVG(mount.container)).toBe(svg);
  expectFixedAsset(svg, EXPAND);
  expectSVGProps(svg, { className: "native-icon-cycle", width: 16, height: 16, opacity: 1, label: "循环图标" });
  const expandedChildren = Array.from(svg.childNodes);

  mount.rerender(
    <NativeComposerIcon
      name="expand"
      className="native-icon-expanded-props"
      width={28}
      height={30}
      style={{ opacity: 0.75 }}
      aria-label="展开图标"
    />,
  );
  expect(rootSVG(mount.container)).toBe(svg);
  expectFixedAsset(svg, EXPAND);
  expectSVGProps(svg, { className: "native-icon-expanded-props", width: 28, height: 30, opacity: 0.75, label: "展开图标" });
  const expandedPropsChildren = Array.from(svg.childNodes);

  mount.rerender(<NativeComposerIcon name="chevron" {...initialProps} />);
  expect(rootSVG(mount.container)).toBe(svg);
  expectFixedAsset(svg, CHEVRON);
  expectSVGProps(svg, { className: "native-icon-cycle", width: 16, height: 16, opacity: 1, label: "循环图标" });
  const returnedChildren = Array.from(svg.childNodes);

  mount.rerender(
    <NativeComposerIcon
      name="chevron"
      className="native-icon-returned-props"
      width={18}
      height={22}
      style={{ opacity: 0.5 }}
      aria-label="返回图标"
    />,
  );
  expect(rootSVG(mount.container)).toBe(svg);
  expectFixedAsset(svg, CHEVRON);
  expectSVGProps(svg, { className: "native-icon-returned-props", width: 18, height: 22, opacity: 0.5, label: "返回图标" });
  const returnedPropsChildren = Array.from(svg.childNodes);

  // A name change may replace paths; only unchanged-name updates require identity.
  expectChildIdentity("expanded name with changed SVG props", expandedChildren, expandedPropsChildren);
  expectChildIdentity("returned name with changed SVG props", returnedChildren, returnedPropsChildren);
});
