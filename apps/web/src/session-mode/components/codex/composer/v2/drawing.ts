export interface Point {
  x: number;
  y: number;
}
export interface DrawingMark {
  id: string;
  kind: "pen" | "arrow" | "rect" | "text" | "comment";
  points: Point[];
  color: string;
  width: number;
  text?: string;
}
export interface DrawingDocument {
  version: 1;
  width: number;
  height: number;
  marks: DrawingMark[];
}
export interface ImageDrawing {
  document: DrawingDocument;
  originalPath?: string;
  originalFile?: File;
}
let textCanvas: CanvasRenderingContext2D | null | undefined;
export function drawingTextLayout(
  mark: DrawingMark,
  size: { width: number; height: number },
  measure?: (text: string) => number,
) {
  const fontSize = Math.max(18, mark.width * 6),
    lineHeight = Math.ceil(fontSize * 1.35);
  if (!measure) {
    textCanvas ??= document.createElement("canvas").getContext("2d");
    if (textCanvas) textCanvas.font = `${fontSize}px sans-serif`;
    measure = (text) =>
      textCanvas?.measureText(text).width ?? text.length * fontSize;
  }
  const baseX = Math.max(14, Math.min(mark.points[0].x, size.width - 150));
  const x = baseX + (mark.kind === "comment" ? 24 : 0),
    available = Math.max(fontSize, size.width - x - 12);
  const rows: string[] = [];
  for (const line of (mark.text ?? "").split("\n")) {
    let row = "";
    for (const char of line) {
      if (row && measure(row + char) > available) {
        rows.push(row);
        row = "";
      }
      row += char;
    }
    rows.push(row);
  }
  const height = (rows.length - 1) * lineHeight + fontSize;
  const y = Math.max(
    fontSize + 4,
    Math.min(
      mark.points[0].y,
      size.height - 8 - (rows.length - 1) * lineHeight,
    ),
  );
  return {
    fontSize,
    fits: height + 12 <= size.height,
    pin: mark.kind === "comment" ? { x: baseX, y: y - 8 } : undefined,
    lines: rows.map((text, i) => ({ text, x, y: y + i * lineHeight })),
  };
}
export function toDrawingPoint(
  point: Point,
  rect: { left: number; top: number; width: number; height: number },
  size: { width: number; height: number },
  view: { x: number; y: number; zoom: number },
): Point {
  return {
    x: (((point.x - rect.left) * size.width) / rect.width - view.x) / view.zoom,
    y:
      (((point.y - rect.top) * size.height) / rect.height - view.y) / view.zoom,
  };
}
export const blankDrawing = (): DrawingDocument => ({
  version: 1,
  width: 1200,
  height: 800,
  marks: [],
});
export function loadDrawingImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("无法加载原图，请检查附件是否仍可访问"));
    image.src = source;
  });
}
export function arrowHead(a: Point, b: Point, width: number): [Point, Point] {
  const angle = Math.atan2(b.y - a.y, b.x - a.x),
    length = Math.max(12, width * 4);
  return [-Math.PI / 6, Math.PI / 6].map((d) => ({
    x: b.x - length * Math.cos(angle + d),
    y: b.y - length * Math.sin(angle + d),
  })) as [Point, Point];
}
export async function drawingToFile(
  doc: DrawingDocument,
  source?: string,
): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = doc.width;
  canvas.height = doc.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("此浏览器不支持绘图导出");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, doc.width, doc.height);
  if (source)
    ctx.drawImage(await loadDrawingImage(source), 0, 0, doc.width, doc.height);
  let commentNumber = 0;
  for (const mark of doc.marks) {
    const first = mark.points[0],
      last = mark.points.at(-1);
    if (!first || !last) continue;
    ctx.strokeStyle = mark.color;
    ctx.fillStyle = mark.color;
    ctx.lineWidth = mark.width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (mark.kind === "rect")
      ctx.strokeRect(first.x, first.y, last.x - first.x, last.y - first.y);
    else if (mark.kind === "pen" || mark.kind === "arrow") {
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (const p of mark.points.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      if (mark.points.length === 1) {
        ctx.beginPath();
        ctx.arc(first.x, first.y, mark.width / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      if (mark.kind === "arrow") {
        const [a, b] = arrowHead(first, last, mark.width);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(last.x, last.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    } else {
      ctx.font = `${Math.max(18, mark.width * 6)}px sans-serif`;
      const layout = drawingTextLayout(
        mark,
        doc,
        (text) => ctx.measureText(text).width,
      );
      if (layout.pin) {
        commentNumber++;
        ctx.beginPath();
        ctx.arc(layout.pin.x, layout.pin.y, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.font = "14px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(String(commentNumber), layout.pin.x, layout.pin.y + 5);
        ctx.textAlign = "start";
        ctx.fillStyle = mark.color;
      }
      ctx.font = `${layout.fontSize}px sans-serif`;
      for (const line of layout.lines) ctx.fillText(line.text, line.x, line.y);
    }
  }
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) =>
        b ? resolve(b) : reject(new Error("图片导出失败，编辑内容已保留")),
      "image/png",
    ),
  );
  return new File([blob], source ? "标注图片.png" : "草图.png", {
    type: "image/png",
  });
}
