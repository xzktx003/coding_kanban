export function isMarkdownFileName(name: string): boolean {
  return /\.(?:md|markdown)$/i.test(name);
}
