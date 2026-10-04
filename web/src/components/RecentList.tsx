import { useRef, useState } from 'preact/hooks';
import { IconChevronRight, IconClose } from '../icons/ui.tsx';

export type RecentItem = { id: string; label: string; sub: string; href: string };

export function RecentList({ items, onOpen, onRemove }: { items: RecentItem[]; onOpen: (item: RecentItem) => void; onRemove: (item: RecentItem) => void }) {
  if (items.length === 0) return null;
  return (
    <section class="tf-section tf-section--tight" aria-labelledby="recent-heading">
      <h2 id="recent-heading">Recent</h2>
      {items.map((item) => (
        <SwipeRow key={item.id} item={item} onOpen={onOpen} onRemove={onRemove} />
      ))}
    </section>
  );
}

// How far left a row must travel, as a share of its width, to be removed when let go.
const REMOVE_AT = 0.35;
// Movement before deciding whether a touch is a swipe or a scroll.
const DECIDE_PX = 10;

// A recent search that swiping left removes. The row claims only sideways movement
// (touch-action: pan-y), so vertical scrolling stays the browser's own, and a touch counts as a
// swipe only once it moves clearly more sideways than up or down. Swiping has no keyboard or
// screen reader equivalent, so the row also has a Remove button that shows on keyboard focus.
function SwipeRow({ item, onOpen, onRemove }: { item: RecentItem; onOpen: (item: RecentItem) => void; onRemove: (item: RecentItem) => void }) {
  const row = useRef<HTMLDivElement>(null);
  // dx is kept here too: state may not have re-rendered by the time the finger lifts.
  const gesture = useRef<{ id: number; x: number; y: number; dx: number; swiping: boolean } | null>(null);
  // A swipe ends with a click on the link, which must not open the search.
  const swiped = useRef(false);
  const [offset, setOffset] = useState(0);
  const [leaving, setLeaving] = useState(false);

  const reset = () => {
    gesture.current = null;
    setOffset(0);
  };
  const remove = () => {
    setLeaving(true);
    setTimeout(() => onRemove(item), 180);
  };

  return (
    <div
      ref={row}
      class={`tf-recent-row${leaving ? ' tf-recent-row--leaving' : ''}`}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dx: 0, swiping: false };
        swiped.current = false;
      }}
      onPointerMove={(event) => {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        const dx = event.clientX - current.x;
        const dy = event.clientY - current.y;
        if (!current.swiping) {
          if (Math.abs(dy) > DECIDE_PX && Math.abs(dy) >= Math.abs(dx)) return reset();
          if (dx > -DECIDE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          current.swiping = true;
          row.current?.setPointerCapture(event.pointerId);
        }
        current.dx = Math.min(0, dx);
        setOffset(current.dx);
      }}
      onPointerUp={(event) => {
        const current = gesture.current;
        if (!current || current.id !== event.pointerId) return;
        if (current.swiping) {
          swiped.current = true;
          const width = row.current?.offsetWidth ?? 1;
          if (-current.dx > width * REMOVE_AT) remove();
          else reset();
        } else {
          gesture.current = null;
        }
      }}
      onPointerCancel={reset}
    >
      <div class="tf-recent-row__behind" aria-hidden="true">
        Remove
      </div>
      <a
        class={`tf-recent${gesture.current?.swiping ? ' tf-recent--dragging' : ''}`}
        style={{ transform: `translateX(${leaving ? '-100%' : `${offset}px`})` }}
        href={item.href}
        // Dragging a link starts the browser's own drag and drop, which cancels the swipe.
        draggable={false}
        onClick={(event) => {
          event.preventDefault();
          if (swiped.current) {
            swiped.current = false;
            return;
          }
          onOpen(item);
        }}
      >
        <span class="tf-recent__text">
          <span class="tf-recent__label">{item.label}</span>
          <span class="tf-recent__sub">{item.sub}</span>
        </span>
        <span class="tf-muted">
          <IconChevronRight />
        </span>
      </a>
      <button type="button" class="tf-recent-remove" aria-label={`Remove ${item.label} from recent`} onClick={remove}>
        <IconClose size={18} />
      </button>
    </div>
  );
}
