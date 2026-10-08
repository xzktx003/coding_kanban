import { PROJECT_REPOSITORY_URL } from "../../lib/product-links";

export default function AboutView() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-background text-foreground p-8 select-none">
      <img
        src="/favicon.svg"
        alt="Coding Kanban"
        className="w-16 h-16 rounded-xl"
      />
      <div className="text-center">
        <h1 className="text-xl font-semibold">Coding Kanban · 会话模式</h1>
      </div>
      <p className="text-sm text-center text-muted-foreground max-w-xs">
        Codex、Claude Code、ACP 与 Bots 的结构化会话工作台
      </p>
      <a
        className="text-sm text-blue-500 hover:underline cursor-pointer"
        href={PROJECT_REPOSITORY_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        BrotherHappy/coding-kanban
      </a>
    </div>
  );
}
