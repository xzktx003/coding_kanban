export type DiffCountLine = {
  type: 'add' | 'remove' | 'normal';
};

export type UnifiedFileDiff = {
  path: string;
  diff: string;
};

type GetDiffCountsInput = {
  unifiedDiff?: string;
  normalizedUnified?: string;
  diffLines?: DiffCountLine[];
};

type DiffCounts = {
  addedCount: number;
  removedCount: number;
};

export function getDiffCounts({
  unifiedDiff,
  normalizedUnified,
  diffLines,
}: GetDiffCountsInput): DiffCounts {
  const resolvedUnified = normalizedUnified || normalizeUnifiedDiff(unifiedDiff);

  if (resolvedUnified) {
    let added = 0;
    let removed = 0;
    const lines = resolvedUnified.split('\n');

    for (const line of lines) {
      if (shouldSkipUnifiedCountLine(line)) continue;
      if (line.startsWith('+')) {
        added += 1;
        continue;
      }
      if (line.startsWith('-')) removed += 1;
    }

    return { addedCount: added, removedCount: removed };
  }

  let added = 0;
  let removed = 0;
  for (const line of diffLines ?? []) {
    if (line.type === 'add') added += 1;
    if (line.type === 'remove') removed += 1;
  }
  return { addedCount: added, removedCount: removed };
}

export function normalizeUnifiedDiff(value?: string): string {
  if (!value) return '';
  return value.replace(/^```diff\n?|```$/g, '');
}

export function splitUnifiedDiffByFile(value?: string): UnifiedFileDiff[] {
  const normalized = normalizeUnifiedDiff(value);
  if (!normalized.trim()) return [];

  const lines = normalized.split('\n');
  const chunks: string[][] = [];
  let currentChunk: string[] = [];

  const pushChunk = () => {
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
    }
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ') && currentChunk.length > 0) {
      pushChunk();
    }
    currentChunk.push(line);
  }
  pushChunk();

  return chunks.map((chunk) => {
    const diff = chunk.join('\n');
    const path = extractDiffPath(chunk);
    return { path, diff };
  });
}

function extractDiffPath(lines: string[]): string {
  const diffGit = lines.find((line) => line.startsWith('diff --git '));
  if (diffGit) {
    const match = diffGit.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match) {
      const preferred = match[2] !== '/dev/null' ? match[2] : match[1];
      return preferred.replace(/^([ab])\//, '');
    }
  }

  const plusLine = lines.find((line) => line.startsWith('+++ '));
  if (plusLine) {
    const plusPath = plusLine.replace(/^\+\+\+\s+/, '').replace(/^([ab])\//, '');
    if (plusPath !== '/dev/null') return plusPath;
  }

  const minusLine = lines.find((line) => line.startsWith('--- '));
  if (minusLine) {
    const minusPath = minusLine.replace(/^---\s+/, '').replace(/^([ab])\//, '');
    if (minusPath !== '/dev/null') return minusPath;
  }

  return '';
}

const shouldSkipUnifiedCountLine = (line: string) =>
  line === '\\ No newline at end of file' ||
  line.startsWith('diff --git') ||
  line.startsWith('index ') ||
  line.startsWith('@@') ||
  line.startsWith('+++ ') ||
  line.startsWith('--- ') ||
  /^\s*(new file|deleted file)\b/i.test(line) ||
  /^\s*mode \d+/i.test(line) ||
  /^\s*(new mode|old mode)\b/i.test(line) ||
  /^\s*similarity index\b/i.test(line) ||
  /^\s*rename (from|to)\b/i.test(line);
