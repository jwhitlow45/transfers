import { useEffect, useRef, useState } from 'preact/hooks';
import { focusInstead } from '../focus.ts';
import { motionOff } from '../gestures.ts';
import { IconBookmark, IconInfo, IconPin, IconUnpin } from '../icons/ui.tsx';
import { topUnderHeader } from '../lib/scroll.ts';

// `about` picks the icon: a trip pinned or unpinned, a search saved or removed from saved, or a
// notice. `pinned` is the search a pin is for, where a screen shows several pinned trips.
export type ToastMessage = { id: number; text: string; about: 'pin' | 'unpin' | 'saved' | 'unsaved' | 'notice'; pinned?: string; undo?: () => void };

// A tap on a note of a trip pinned takes the rider to its pinned card, above the screen's sticky
// header, and marks it for a moment (J, 2026-10-08).
function showPinned(pinned: string | undefined) {
  const card = document.querySelector<HTMLElement>(`.tf-layer ${pinned ? `[data-pin="${CSS.escape(pinned)}"] ` : ''}.tf-pinned`);
  const placed = card && topUnderHeader(card, 12);
  if (!card || !placed) return;
  const { scroller, top } = placed;
  // A frame after the tap, whose own focus change would otherwise stop the scroll, and the mark
  // a frame after that, as forcing a layout to restart it would stop it too.
  card.classList.remove('tf-pinned--shown');
  requestAnimationFrame(() => {
    scroller.scrollTo({ top, behavior: motionOff() ? 'auto' : 'smooth' });
    requestAnimationFrame(() => card.classList.add('tf-pinned--shown'));
  });
}

// How long a toast stays, unless the rider is pointing at it or has focus in it.
const TOAST_MS = 5000;
// As long as it takes to slide away (tf-toast-out in styles.css).
const LEAVE_MS = 160;

// A short note at the bottom of the screen after the rider pins or unpins a trip, saves a search or
// removes it, or dismisses or restores a notice, with Undo for a tap they did not mean. It rises into place and sinks away.
// The region is always there, so screen readers announce what fills it, and it never takes focus.
// `page` places it on a screen with no bottom bar to sit above.
export function Toast({ message, page = false, onDone }: { message: ToastMessage | null; page?: boolean; onDone: () => void }) {
  const [held, setHeld] = useState(false);
  // The last note stays while it sinks away after `message` clears.
  const [shown, setShown] = useState(message);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    if (message) {
      setShown(message);
      setLeaving(false);
      return;
    }
    setLeaving(true);
    const timer = setTimeout(() => setShown(null), motionOff() ? 0 : LEAVE_MS);
    return () => clearTimeout(timer);
  }, [message?.id]);
  useEffect(() => {
    if (!message || held) return;
    const timer = setTimeout(onDone, TOAST_MS);
    return () => clearTimeout(timer);
  }, [message?.id, held]);
  const icon = {
    pin: <IconPin filled size={15} />,
    unpin: <IconUnpin size={15} />,
    saved: <IconBookmark filled size={16} />,
    unsaved: <IconBookmark size={16} />,
    notice: <IconInfo size={18} />,
  };
  return (
    <div
      class={`tf-toast-region${page ? ' tf-toast-region--page' : ''}`}
      role="status"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusIn={() => setHeld(true)}
      onFocusOut={() => setHeld(false)}
    >
      {shown && (
        // One element whatever it says, so a note replacing another changes in place rather than
        // sinking and rising again.
        <div class={`tf-toast${leaving ? ' tf-toast--leaving' : ''}`}>
          {shown.about === 'pin' ? (
            <button type="button" class="tf-toast__text tf-toast__show" onClick={() => showPinned(shown.pinned)}>
              <span class="tf-toast__icon">{icon[shown.about]}</span>
              {shown.text}
            </button>
          ) : (
            <span class="tf-toast__text">
              <span class="tf-toast__icon">{icon[shown.about]}</span>
              {shown.text}
            </span>
          )}
          {shown.undo && !leaving && (
            <button
              type="button"
              class="tf-toast__undo"
              onClick={() => {
                shown.undo!();
                onDone();
                // Undo leaves with the note, so focus goes back to the page, or to a sheet open over
                // it, which the note shows above.
                requestAnimationFrame(() => focusInstead(document.querySelector<HTMLElement>('.tf-sheet__panel')));
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// A screen's toast: the note showing, `show` for a new one, which takes the place of any showing,
// and `clear` once it has gone.
export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const ids = useRef(0);
  return { toast, show: (message: Omit<ToastMessage, 'id'>) => setToast({ ...message, id: ++ids.current }), clear: () => setToast(null) };
}
