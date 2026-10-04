import { useRef } from 'preact/hooks';
import { useVerticalDrag } from '../gestures.ts';
import { IconRefresh } from '../icons/ui.tsx';

// The indicator moves half as far as the finger, and a pull this far refreshes when let go.
const RESISTANCE = 0.5;
const READY_PX = 56;
const MAX_PX = 80;

// Pull down from the top of a screen to fetch its data again now. Phones' own pull to refresh
// reloads the whole page, losing open cards and settings and failing outright when offline,
// and home screen apps have none at all. This one only refetches, and the last results stay up
// if that fails. It lives in the sticky header and drags the screen scroller that holds it.
export function PullToRefresh({ onRefresh }: { onRefresh: () => void }) {
  const indicator = useRef<HTMLDivElement>(null);
  const scroller = () => indicator.current?.closest('.tf-scroll');
  const show = (pull: number, animated: boolean) => {
    const element = indicator.current;
    if (!element) return;
    element.style.transition = animated ? '' : 'none';
    element.style.transform = pull > 0 ? `translateY(${pull}px)` : '';
    element.style.setProperty('--pull-turn', `${(pull / READY_PX) * 270}deg`);
    element.style.opacity = pull > 0 ? String(Math.min(1, pull / READY_PX)) : '';
    element.classList.toggle('tf-pull--ready', pull >= READY_PX);
  };
  const pullOf = (dy: number) => Math.min(MAX_PX, Math.max(0, dy * RESISTANCE));
  useVerticalDrag(scroller, {
    claim: (direction) => direction === 'down' && (scroller()?.scrollTop ?? 1) <= 0,
    move: (dy) => show(pullOf(dy), false),
    end: (release) => {
      if (release && pullOf(release.dy) >= READY_PX) onRefresh();
      show(0, true);
    },
  });
  return (
    <div class="tf-pull-track" aria-hidden="true">
      <div class="tf-pull" ref={indicator}>
        <IconRefresh />
      </div>
    </div>
  );
}
