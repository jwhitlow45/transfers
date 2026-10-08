import { useEffect, useState } from 'preact/hooks';
import { focusInstead } from '../focus.ts';
import { motionOff } from '../gestures.ts';
import { IconInfo, IconPin, IconUnpin } from '../icons/ui.tsx';

// `about` picks the icon: a trip pinned, a trip unpinned, or a notice.
export type ToastMessage = { id: number; text: string; about: 'pin' | 'unpin' | 'notice'; undo?: () => void };

// How long a toast stays, unless the rider is pointing at it or has focus in it.
const TOAST_MS = 5000;
// As long as it takes to slide away (tf-toast-out in styles.css).
const LEAVE_MS = 160;

// A short note at the bottom of the screen after the rider pins or unpins a trip, or dismisses or
// restores a notice, with Undo for a tap they did not mean. It rises into place and sinks away.
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
  const icon = { pin: <IconPin filled size={15} />, unpin: <IconUnpin size={15} />, notice: <IconInfo size={18} /> };
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
