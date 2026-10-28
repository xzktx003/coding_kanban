import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type PointerSensorOptions,
  type SensorProps,
} from "@dnd-kit/core";
import {
  restrictToFirstScrollableAncestor,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  isAgentInteractionVisible,
  useAgentInteractionVisible,
} from "@session/session-dom";
import "./queue-reorder.css";

const Enabled = createContext(false);
const Row = createContext<ReturnType<typeof useSortable> | null>(null);
export function useQueueItemDragging() {
  return useContext(Row)?.isDragging ?? false;
}
const modifiers = [restrictToVerticalAxis, restrictToFirstScrollableAncestor];
type Gesture = { identity: string; ids: string[] };
type OwnedPointerOptions = PointerSensorOptions & {
  registerCancel: (cancel: () => void) => () => void;
};

// core 6.3.1 keeps a live sensor after DndContext unmount. Its pinned internal
// cancel path detaches the owned document listeners (including delayed click
// suppression) before notifying React. Do not dispatch global synthetic events.
class QueuePointerSensor extends PointerSensor {
  constructor(props: SensorProps<OwnedPointerOptions>) {
    let unregister = () => {};
    super({
      ...props,
      onEnd: () => {
        unregister();
        props.onEnd();
      },
      onCancel: () => {
        unregister();
        props.onCancel();
      },
    });
    unregister = props.options.registerCancel(() => {
      (this as unknown as { handleCancel: () => void }).handleCancel();
    });
  }
}

/** Matches the official queued-list PointerSensor, with captured queue ownership. */
export function QueueReorderList({
  identity,
  ids,
  enabled,
  onReorder,
  header,
  children,
}: {
  identity: string;
  ids: string[];
  enabled: boolean;
  onReorder: (ids: string[]) => void;
  header?: ReactNode;
  children: ReactNode;
}) {
  const visible = useAgentInteractionVisible();
  const allowed = enabled && visible;
  const hasHeader = !!header;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  const sensorCancel = useRef<(() => void) | null>(null);
  const registerCancel = useCallback((cancel: () => void) => {
    sensorCancel.current = cancel;
    return () => {
      if (sensorCancel.current === cancel) sensorCancel.current = null;
    };
  }, []);
  const sensors = useSensors(
    useSensor(QueuePointerSensor, {
      activationConstraint: { distance: 6 },
      registerCancel,
    }),
  );
  const [generation, setGeneration] = useState(0);
  const gesture = useRef<Gesture | null>(null);
  const latest = useRef({ identity, ids, allowed });
  latest.current = { identity, ids, allowed };
  useEffect(() => {
    if (!allowed) return;
    const cancel = () => {
      if (!gesture.current) return;
      gesture.current = null;
      sensorCancel.current?.();
      setGeneration((value) => value + 1);
    };
    const cancelHidden = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", cancelHidden);
    document.addEventListener("pointercancel", cancel);
    return () => {
      gesture.current = null;
      sensorCancel.current?.();
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", cancelHidden);
      document.removeEventListener("pointercancel", cancel);
    };
  }, [allowed]);
  const signature = JSON.stringify(ids);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const update = () => {
      // The surrounding rail animates its height on entry. Compare against
      // this list's own cap so that animation does not briefly fade a queue
      // that fits in its final layout.
      const maxHeight = Number.parseFloat(getComputedStyle(element).maxHeight);
      const scrollport = Number.isFinite(maxHeight)
        ? maxHeight
        : element.clientHeight;
      const next = element.scrollHeight > scrollport + 1;
      setScrollable((current) => (current === next ? current : next));
    };
    update();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    const items = element.querySelector(".session-queue-items");
    if (items) observer?.observe(items);
    const status = element.querySelector(".session-queue-status");
    if (status) observer?.observe(status);
    window.addEventListener("resize", update);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [hasHeader, identity, ids.length]);
  useEffect(() => {
    if (gesture.current) {
      gesture.current = null;
      sensorCancel.current?.();
      setGeneration((value) => value + 1);
    }
  }, [identity, signature, allowed]);
  const end = ({ active, over }: DragEndEvent) => {
    const captured = gesture.current;
    gesture.current = null;
    const current = latest.current;
    if (
      !captured ||
      !current.allowed ||
      !isAgentInteractionVisible() ||
      document.hidden ||
      captured.identity !== current.identity ||
      JSON.stringify(captured.ids) !== JSON.stringify(current.ids) ||
      !over
    )
      return;
    const from = captured.ids.indexOf(String(active.id)),
      to = captured.ids.indexOf(String(over.id));
    if (from >= 0 && to >= 0 && from !== to)
      onReorder(arrayMove(captured.ids, from, to));
  };
  return (
    <div
      ref={scrollRef}
      className="session-queue-list"
      data-overflowing={scrollable ? "true" : undefined}
    >
      {header}
      <Enabled.Provider value={allowed}>
        <DndContext
          key={generation}
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={modifiers}
          onDragEnd={end}
          onDragAbort={() => {
            gesture.current = null;
          }}
          onDragCancel={() => {
            gesture.current = null;
          }}
          accessibility={{
            screenReaderInstructions: {
              draggable:
                "拖动手柄调整顺序；键盘用户可在消息菜单中选择上移或下移。",
            },
          }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {ids.length > 0 ? (
              <ol
                className="session-queue-items"
                onPointerDownCapture={(event) => {
                  if (
                    allowed &&
                    event.isPrimary &&
                    event.button === 0 &&
                    (event.target as Element).closest(
                      ".session-queue-drag-handle",
                    )
                  ) {
                    gesture.current = { identity, ids: [...ids] };
                  }
                }}
              >
                {children}
              </ol>
            ) : null}
          </SortableContext>
        </DndContext>
      </Enabled.Provider>
    </div>
  );
}

export function QueueSortableItem({
  id,
  status,
  children,
}: {
  id: string;
  status: string;
  children: ReactNode;
}) {
  const enabled = useContext(Enabled);
  const sortable = useSortable({ id, disabled: !enabled });
  return (
    <Row.Provider value={sortable}>
      <li
        ref={sortable.setNodeRef}
        data-followup-id={id}
        data-status={status}
        data-queue-dragging={
          enabled && sortable.isDragging ? "true" : undefined
        }
        style={{
          transform: enabled
            ? CSS.Translate.toString(sortable.transform)
            : undefined,
          transition: sortable.transition,
        }}
      >
        {children}
      </li>
    </Row.Provider>
  );
}

export function QueueDragHandle({
  position,
  children,
}: {
  position: number;
  children: ReactNode;
}) {
  const enabled = useContext(Enabled),
    row = useContext(Row);
  if (!enabled || !row) return children;
  return (
    <span
      ref={row.setActivatorNodeRef}
      className="session-queue-drag-handle"
      {...row.attributes}
      {...row.listeners}
      aria-label={`拖动排序排队消息 ${position}`}
    >
      <svg
        className="session-queue-grip"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        {[9.5, 14.5].flatMap((x) =>
          [5.5, 12, 18.5].map((y) => (
            <circle
              key={`${x}:${y}`}
              cx={x}
              cy={y}
              r="1.5"
              fill="currentColor"
            />
          )),
        )}
      </svg>
      {children}
    </span>
  );
}
