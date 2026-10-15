// User-approved iPhone 16 dimensions. This is browser simulation, not iOS hardware.
// https://support.apple.com/en-us/121029 (1179 x 2556 physical pixels).
export const iphone16Context = Object.freeze({
  viewport: Object.freeze({ width: 393, height: 852 }),
  screen: Object.freeze({ width: 393, height: 852 }),
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
});

export const iphone16Viewports = Object.freeze([
  Object.freeze({ name: "full", width: 393, height: 852 }),
  Object.freeze({ name: "browser-toolbar", width: 393, height: 659 }),
  Object.freeze({ name: "keyboard-occlusion", width: 393, height: 430 }),
]);

/** Observe the actual engine; do not overwrite navigator or synthesize touch success. */
export async function mobileEnvironment(page) {
  return page.evaluate(() => ({
    screen: { width: screen.width, height: screen.height },
    viewport: { width: innerWidth, height: innerHeight },
    visualViewport: window.visualViewport && {
      width: window.visualViewport.width,
      height: window.visualViewport.height,
    },
    dpr: devicePixelRatio,
    maxTouchPoints: navigator.maxTouchPoints,
    coarsePointer: matchMedia("(pointer: coarse)").matches,
    hover: matchMedia("(hover: hover)").matches,
    userAgent: navigator.userAgent,
  }));
}
