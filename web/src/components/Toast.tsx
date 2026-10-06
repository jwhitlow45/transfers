import { useEffect, useState } from 'preact/hooks';
import { IconPin } from '../icons/ui.tsx';

export type ToastMessage = { id: number; text: string; undo?: () => void };

// How long a toast stays, unless the rider is pointing at it or has focus in it.
const TOAST_MS = 5000;

// A short note above the bottom bar after the rider pins or unpins a trip, with Undo for a tap
// they did not mean. The region is always there, so screen readers announce what fills it, and
// it never takes focus.
export function Toast({ message, onDone }: { message: ToastMessage | null; onDone: () => void }) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!message || held) return;
    const timer = setTimeout(onDone, TOAST_MS);
    return () => clearTimeout(timer);
  }, [message?.id, held]);
  return (
    <div
      class="tf-toast-region"
      role="status"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusIn={() => setHeld(true)}
      onFocusOut={() => setHeld(false)}
    >
      {message && (
        <div key={message.id} class="tf-toast">
          <span class="tf-toast__text">
            <IconPin filled size={15} />
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
