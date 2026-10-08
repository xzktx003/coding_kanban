export function formatEditorContext(
  path: string,
  text: string,
  range?: { start: number; end: number },
) {
  const runs = text.match(/`+/g) ?? [];
  const fence = "`".repeat(Math.max(3, ...runs.map((s) => s.length + 1)));
  return `文件：${path}${range ? `:${range.start}-${range.end}` : ""}\n${fence}\n${text}\n${fence}`;
}
