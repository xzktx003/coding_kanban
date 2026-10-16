import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { toast } from 'sonner';
import { writeNativeMarkdownClipboard } from '@session/components/codex/presentation/nativeMarkdownClipboard';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@session/components/ui/context-menu';
import type { Todo, TodoCategory } from '@session/stores/useTodoStore';

type TodoContextMenuProps = {
  /** Every todo the menu acts on: the selection, or just the clicked row. */
  targets: Todo[];
  categories: TodoCategory[];
  isExpanded: boolean;
  onToggleDone: (done: boolean) => void;
  onPin: (pinned: boolean) => void;
  onMove: (categoryId: string | null) => void;
  onToggleExpand: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onSendToComposer: () => void;
  children: ReactNode;
};

type TodoCopyController = {
  owner: object | null;
  pending: { owner: object; done: (done: boolean) => void } | null;
};
function observeTodoCopy(write: Promise<void>, controller: TodoCopyController, owner: object) {
  // Only the revocable controller crosses the asynchronous boundary. Cleanup
  // releases the captured callback, which may itself close over Todo text.
  void write.then(
    () => {
      if (controller.owner !== owner || controller.pending?.owner !== owner) return;
      const done = controller.pending.done;
      controller.pending = null;
      done(true);
    },
    () => {
      if (controller.owner !== owner || controller.pending?.owner !== owner) return;
      controller.pending = null;
      toast.error('Failed to copy todos');
    },
  );
}
function copyTodos(text: string, controller: TodoCopyController, done: (done: boolean) => void) {
  const owner = controller.owner;
  if (!owner || controller.pending) return;
  controller.pending = { owner, done };
  observeTodoCopy(writeNativeMarkdownClipboard(text), controller, owner);
}

export function TodoContextMenu({
  targets,
  categories,
  isExpanded,
  onToggleDone,
  onPin,
  onMove,
  onToggleExpand,
  onEdit,
  onDelete,
  onSendToComposer,
  children,
}: TodoContextMenuProps) {
  const copyController = useRef<TodoCopyController>({ owner: null, pending: null }).current;
  const copySources = useRef<Map<string, string> | null>(null);
  // Compare source versions only in the mounted component. The pending observer
  // receives an empty token, never this map or an extra copy of the Todo body.
  useLayoutEffect(() => {
    const sources = new Map(targets.map(todo => [todo.id, todo.text]));
    const previous = copySources.current;
    if (!previous || previous.size !== sources.size ||
      [...sources].some(([id, text]) => previous.get(id) !== text)) {
      copyController.owner = {};
      copyController.pending = null;
    }
    copySources.current = sources;
  });
  useLayoutEffect(() => {
    return () => {
      copyController.owner = null;
      copyController.pending = null;
      copySources.current = null;
    };
  }, [copyController]);
  const isSingle = targets.length === 1;
  const allDone = targets.every((todo) => todo.isDone);
  const allPinned = targets.every((todo) => todo.pinnedAt != null);
  const suffix = isSingle ? '' : ` (${targets.length})`;
  const asText = () => targets.map((todo) => todo.text).join('\n');

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        {/* The point of capturing agent output: hand it back as the next prompt. */}
        <ContextMenuItem onSelect={onSendToComposer}>Send to composer{suffix}</ContextMenuItem>

        <ContextMenuSeparator />

        {/* Copying a todo marks it done — in plux, copying is how a todo gets used up. */}
        <ContextMenuItem
          onSelect={() => {
            copyTodos(asText(), copyController, onToggleDone);
          }}
        >
          Copy{suffix}
          <ContextMenuShortcut>⌘C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem
          onSelect={() => {
            copyTodos(targets.map((todo) => `- ${todo.text}`).join('\n'), copyController, onToggleDone);
          }}
        >
          Copy as list{suffix}
          <ContextMenuShortcut>⇧⌘C</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem onSelect={() => onToggleDone(!allDone)}>
          {allDone ? 'Mark as not done' : 'Mark as done'}
          {suffix}
          <ContextMenuShortcut>Space</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onPin(!allPinned)}>
          {allPinned ? 'Unpin' : 'Pin'}
          {suffix}
        </ContextMenuItem>

        {isSingle ? (
          <>
            <ContextMenuItem onSelect={onToggleExpand}>
              {isExpanded ? 'Collapse' : 'Expand'}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={onEdit}>Edit</ContextMenuItem>
          </>
        ) : (
          <ContextMenuSeparator />
        )}

        <ContextMenuSub>
          <ContextMenuSubTrigger>Move to</ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-44">
            {categories.length === 0 ? (
              <ContextMenuItem disabled>No categories yet</ContextMenuItem>
            ) : (
              <>
                {categories.map((category) => (
                  <ContextMenuItem
                    key={category.id}
                    disabled={targets.every((todo) => todo.categoryId === category.id)}
                    onSelect={() => onMove(category.id)}
                  >
                    {category.name}
                  </ContextMenuItem>
                ))}
                <ContextMenuSeparator />
                <ContextMenuItem
                  disabled={targets.every((todo) => todo.categoryId === null)}
                  onSelect={() => onMove(null)}
                >
                  None
                </ContextMenuItem>
              </>
            )}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        <ContextMenuItem variant="destructive" onSelect={onDelete}>
          Delete{suffix}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
