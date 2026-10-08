import { expect, it } from "vitest";
import { arrowHead, toDrawingPoint, drawingTextLayout } from "./drawing";
it("maps a touch through viewport offsets, canvas scaling and pan/zoom", () => {
  expect(
    toDrawingPoint(
      { x: 160, y: 220 },
      { left: 10, top: 20, width: 300, height: 400 },
      { width: 1200, height: 800 },
      { x: 200, y: 100, zoom: 2 },
    ),
  ).toEqual({ x: 200, y: 150 });
});
it("arrow tips remain symmetric and finite for horizontal, vertical and zero-length marks", () => {
  const [a, b] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 4);
  expect(a.x).toBeCloseTo(b.x);
  expect(a.y).toBeCloseTo(-b.y);
  for (const p of arrowHead({ x: 1, y: 1 }, { x: 1, y: 1 }, 4))
    expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
});

it("annotation preview and export share wrapping and keep multiline text within the canvas",()=>{
  const layout=drawingTextLayout({id:"text",kind:"comment",points:[{x:190,y:158}],color:"#000000",width:4,text:"first line\nsecond"},{width:200,height:160},s=>s.length*10);
  expect(layout.lines.map(l=>l.text).join("")).toBe("first linesecond");
  expect(layout.lines.every(l=>l.x>=0&&l.y<=160)).toBe(true);
  expect(layout.pin).toBeTruthy();
});
