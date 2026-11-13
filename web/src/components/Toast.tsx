import { useEffect, useRef, useState } from 'preact/hooks';
import { focusInstead } from '../focus.ts';
import { motionOff } from '../gestures.ts';
import { IconBookmark, IconInfo, IconPin, IconUnpin } from '../icons/ui.tsx';

// `about` picks the icon: a pin replaced or unpinned, a search saved or removed from saved, or a
// notice.
export type ToastMessage = { id: number; text: string; about: 'pin' | 'unpin' | 'saved' | 'unsaved' | 'notice'; undo?: () => void };

// How long a toast stays, unless the rider is pointing at it or has focus in it.
const TOAST_MS = 5000;
// As long as it takes to slide away (tf-toast-out in styles.css).
const LEAVE_MS = 160;

// A short note at the bottom of the screen after the rider unpins a trip or pins one in place of
// another, saves a search or removes it, or dismisses or restores a notice, with Undo for a tap
// they did not mean, or after a pin that rings a cable car's bell. It rises into place and sinks away.
// The region is always there, so screen readers announce what fills it, and it never takes focus.
// `page` places it on a screen with no bottom bar to sit above. `above` lifts it that many pixels
// from the bottom, over a bar it is not inside. `quiet` leaves saying it to its owner, as the pin
// bar says its toast through its own status line.
export function Toast({ message, page = false, above = 0, quiet = false, onDone }: { message: ToastMessage | null; page?: boolean; above?: number; quiet?: boolean; onDone: () => void }) {
  const [held, setHeld] = useState(false);
  // Under a sheet over the whole app, or the pin bar's open panel, the page is inert and its toast
  // hidden with it (see .tf-toast-region in styles.css), so the toast waits, its time starting over
  // once the page is back.
  const region = useRef<HTMLDivElement>(null);
  const [covered, setCovered] = useState(false);
  useEffect(() => {
    let layer: HTMLElement | null = region.current;
    while (layer?.parentElement && !layer.parentElement.classList.contains('tf-app')) layer = layer.parentElement;
    if (!layer || typeof MutationObserver === 'undefined') return;
    const watched = layer;
    // Only the page showing is covered. One kept under another page is inert too, and its toast
    // runs out there as before, rather than coming back on the way back.
    const update = () => setCovered(watched.inert && watched.classList.contains('tf-layer'));
    update();
    const observer = new MutationObserver(update);
    observer.observe(watched, { attributes: true, attributeFilter: ['inert', 'class'] });
    return () => observer.disconnect();
  }, []);
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
    if (!message || held || covered) return;
    const timer = setTimeout(onDone, TOAST_MS);
    return () => clearTimeout(timer);
  }, [message?.id, held, covered]);
  const icon = {
    pin: <IconPin filled size={15} />,
    unpin: <IconUnpin size={15} />,
    saved: <IconBookmark filled size={16} />,
    unsaved: <IconBookmark size={16} />,
    notice: <IconInfo size={18} />,
  };
  return (
    <div
      ref={region}
      class={`tf-toast-region${page ? ' tf-toast-region--page' : ''}`}
      role={quiet ? undefined : 'status'}
      style={above > 0 ? { bottom: `calc(${above}px + var(--s2))` } : undefined}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusIn={() => setHeld(true)}
      onFocusOut={() => setHeld(false)}
    >
      {shown && (
        // One element whatever it says, so a note replacing another changes in place rather than
        // sinking and rising again.
        <div class={`tf-toast${leaving ? ' tf-toast--leaving' : ''}`}>
          <span class="tf-toast__text">
            <span class="tf-toast__icon">{icon[shown.about]}</span>
            {shown.text}
          </span>
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
