import { useRef } from 'preact/hooks';
import { SLIDE_MS, motionOff, useDrag } from '../gestures.ts';
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
  const track = useRef<HTMLDivElement>(null);
  const indicator = useRef<HTMLDivElement>(null);
  const hiding = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scroller = () => track.current?.closest('.tf-scroll');
  // The track lies over the top of the screen, so it is laid out only during a pull. Safari can
  // leave what is under such a layer unpainted until the page scrolls.
  const show = (pull: number, animated: boolean) => {
    const element = indicator.current;
    if (!element || !track.current) return;
    clearTimeout(hiding.current);
    track.current.classList.add('tf-pull-track--active');
    if (pull === 0) {
      const hide = () => track.current?.classList.remove('tf-pull-track--active');
      if (animated && !motionOff()) hiding.current = setTimeout(hide, SLIDE_MS);
      else hide();
    }
    element.style.transition = animated ? '' : 'none';
    element.style.transform = pull > 0 ? `translateY(${pull}px)` : '';
    element.style.setProperty('--pull-turn', `${(pull / READY_PX) * 270}deg`);
    element.style.opacity = pull > 0 ? String(Math.min(1, pull / READY_PX)) : '';
    element.classList.toggle('tf-pull--ready', pull >= READY_PX);
  };
  const pullOf = (dy: number) => Math.min(MAX_PX, Math.max(0, dy * RESISTANCE));
  useDrag(scroller, 'y', {
    claim: (direction) => direction === 'down' && (scroller()?.scrollTop ?? 1) <= 0,
    move: (dy) => show(pullOf(dy), false),
    end: (release) => {
      if (release && pullOf(release.distance) >= READY_PX) onRefresh();
      show(0, true);
    },
  });
  return (
    <div class="tf-pull-track" aria-hidden="true" ref={track}>
      <div class="tf-pull" ref={indicator}>
        <IconRefresh />
      </div>
    </div>
  );
}
