export function createLucideImportOptimizer(options: { projectRoot: string }): {
  rewrite(code: string, id?: string): string;
  rewriteFacade(code: string, id?: string): string;
  facadeSource(): string;
  readonly dependencies: string[];
};
export function lucideImportOptimizer(options: { projectRoot: string }): import("vite").Plugin;
