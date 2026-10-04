import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { MAX_MINUTES } from '../../../shared/api.ts';

const spoken = (minutes: number) => `${minutes} minute${minutes === 1 ? '' : 's'}`;
// Where a value sits along the track, as a share of the way from 0 to MAX_MINUTES.
const along = (minutes: number) => minutes / MAX_MINUTES;

// A slider's value as shown while it moves, and committed once it settles: when a thumb is let
// go, or a moment after the last arrow key. A drag or a run of key presses then costs one request
// for new results rather than one per minute passed. A value coming back from the setting is the
// slider's own echo unless it differs from what was last committed.
function useSettling<T>(value: T, same: (a: T, b: T) => boolean, onChange: (value: T) => void) {
  const [shown, setShown] = useState(value);
  const committed = useRef(value);
  const pending = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(onChange);
  latest.current = onChange;
  const flush = () => {
    clearTimeout(timer.current);
    if (!pending.current) return;
    committed.current = pending.current.value;
    latest.current(pending.current.value);
    pending.current = null;
  };
  useEffect(() => {
    if (same(value, committed.current)) return;
    committed.current = value;
    setShown(value);
  }, [value]);
  // Closing the sheet right after a change still keeps it.
  useEffect(() => flush, []);
  const commit = (next: T) => {
    pending.current = { value: next };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SETTLE_MS);
  };
  return [shown, setShown, commit] as const;
}

const SETTLE_MS = 300;

// Minutes as a full-width slider from 0 to MAX_MINUTES.
export function MinutesSlider({ label, help, value, onChange }: { label: string; help: string; value: number; onChange: (value: number) => void }) {
  const id = useId();
  const [shown, setShown, commit] = useSettling(value, (a, b) => a === b, onChange);
  return (
    <div class="tf-setting">
      <div class="tf-slider__head">
        <label class="tf-setting__label" for={id}>
          {label}
        </label>
        <output class="tf-slider__value" for={id}>
          {shown} min
        </output>
      </div>
      <div class="tf-setting__help">{help}</div>
      <div class="tf-slider" style={{ '--from': 0, '--to': along(shown) }}>
        <input
          id={id}
          type="range"
          min={0}
          max={MAX_MINUTES}
          step={1}
          value={shown}
          aria-valuetext={spoken(shown)}
          onInput={(event) => setShown(Number(event.currentTarget.value))}
          onChange={(event) => commit(Number(event.currentTarget.value))}
        />
      </div>
    </div>
  );
}

// The transfer window as one slider with two thumbs, the shortest transfer on the left and the
// longest on the right. Two native range inputs lie on one track, so each thumb keeps its keyboard
// and screen reader behavior. The thumbs cannot pass each other, and the longest is at least a
// minute.
export function WindowSlider({ label, help, window, onChange }: { label: string; help: string; window: { min: number; max: number }; onChange: (window: { min: number; max: number }) => void }) {
  const labelId = useId();
  const [shown, setShown, commit] = useSettling(window, (a, b) => a.min === b.min && a.max === b.max, onChange);
  const low = (value: number) => Math.min(value, shown.max);
  const high = (value: number) => Math.max(value, shown.min, 1);
  // Where the thumbs meet, the one still free to move must be on top, or they could not be
  // dragged apart.
  const lowOnTop = shown.min === shown.max && shown.min > MAX_MINUTES / 2;
  return (
    <div class="tf-setting" role="group" aria-labelledby={labelId}>
      <div class="tf-slider__head">
        <span class="tf-setting__label" id={labelId}>
          {label}
        </span>
        <output class="tf-slider__value">
          {shown.min}–{shown.max} min
        </output>
      </div>
      <div class="tf-setting__help">{help}</div>
      <div class="tf-slider tf-slider--range" style={{ '--from': along(shown.min), '--to': along(shown.max) }}>
        <input
          type="range"
          min={0}
          max={MAX_MINUTES}
          step={1}
          value={shown.min}
          aria-label="Shortest transfer"
          aria-valuetext={spoken(shown.min)}
          style={lowOnTop ? { zIndex: 2 } : undefined}
          onInput={(event) => {
            const min = low(Number(event.currentTarget.value));
            // The thumb itself may have gone past the other one.
            event.currentTarget.value = String(min);
            setShown({ ...shown, min });
          }}
          onChange={(event) => commit({ min: low(Number(event.currentTarget.value)), max: shown.max })}
        />
        <input
          type="range"
          min={0}
          max={MAX_MINUTES}
          step={1}
          value={shown.max}
          aria-label="Longest transfer"
          aria-valuetext={spoken(shown.max)}
          onInput={(event) => {
            const max = high(Number(event.currentTarget.value));
            event.currentTarget.value = String(max);
            setShown({ ...shown, max });
          }}
          onChange={(event) => commit({ min: shown.min, max: high(Number(event.currentTarget.value)) })}
        />
      </div>
    </div>
  );
}
