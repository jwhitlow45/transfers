import { useEffect, useState } from 'preact/hooks';
import { IconInfo, IconPin, IconWarn } from '../icons/ui.tsx';

// `about` picks the look: a pinned trip, or a notice, which looks as the notice did, by its
// severity, with its icon and colors.
export type ToastMessage = { id: number; text: string; about: 'pin' | { severity: 'severe' | 'warning' | 'info' }; undo?: () => void };

// How long a toast stays, unless the rider is pointing at it or has focus in it.
const TOAST_MS = 5000;

// A short note at the bottom of the screen after the rider pins or unpins a trip, or dismisses or
// restores a notice, with Undo for a tap they did not mean. The region is always there, so screen
// readers announce what fills it, and it never takes focus. `page` places it on a screen with no
// bottom bar to sit above.
export function Toast({ message, page = false, onDone }: { message: ToastMessage | null; page?: boolean; onDone: () => void }) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!message || held) return;
    const timer = setTimeout(onDone, TOAST_MS);
    return () => clearTimeout(timer);
  }, [message?.id, held]);
  return (
    <div
      class={`tf-toast-region${page ? ' tf-toast-region--page' : ''}`}
      role="status"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusIn={() => setHeld(true)}
      onFocusOut={() => setHeld(false)}
    >
      {message && (
        // One element whatever it says, so a note replacing another changes in place rather than
        // blinking out and fading back in.
        <div class={`tf-toast${message.about === 'pin' ? '' : ` tf-toast--notice tf-toast--${message.about.severity}`}`}>
          <span class="tf-toast__text">
            <span class="tf-toast__icon">
              {message.about === 'pin' ? <IconPin filled size={15} /> : message.about.severity === 'info' ? <IconInfo size={18} /> : <IconWarn size={18} />}
            </span>
            {message.text}
          </span>
          {message.undo && (
            <button
              type="button"
              class="tf-toast__undo"
              onClick={() => {
                message.undo!();
                onDone();
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
