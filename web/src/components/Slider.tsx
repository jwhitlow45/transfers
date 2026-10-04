import { useEffect, useId, useRef, useState } from 'preact/hooks';
import { MAX_MINUTES } from '../../../shared/api.ts';

const spoken = (minutes: number) => `${minutes} minute${minutes === 1 ? '' : 's'}`;
// Where a value sits along the track, as a share of the way from 0 to MAX_MINUTES.
const along = (minutes: number) => minutes / MAX_MINUTES;

// A slider's value as shown while it moves, and committed once it settles: when a thumb is let
// go, when the slider loses focus, or a moment after the last arrow key. A drag or a run of key
// presses then costs one request for new results rather than one per minute passed. Losing focus
// comes before a tap elsewhere, so a reset tapped right after a change still wins over it. A value
// coming back from the setting is the slider's own echo unless it differs from what was last
// committed, and a different one, such as from a reset, drops any change still waiting.
function useSettling<T>(value: T, same: (a: T, b: T) => boolean, onChange: (value: T) => void) {
  const [shown, setShown] = useState(value);
  const committed = useRef(value);
  const pending = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Set while a pointer drags a thumb, whose release commits at once.
  const pointer = useRef(false);
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
    clearTimeout(timer.current);
    pending.current = null;
    committed.current = value;
    setShown(value);
  }, [value]);
  // Closing the sheet right after a change still keeps it.
  useEffect(() => flush, []);
  const commit = (next: T) => {
    pending.current = { value: next };
    clearTimeout(timer.current);
    if (pointer.current) flush();
    else timer.current = setTimeout(flush, SETTLE_MS);
    pointer.current = false;
  };
  const handlers = { onPointerDown: () => void (pointer.current = true), onBlur: flush };
  return [shown, setShown, commit, handlers] as const;
}

const SETTLE_MS = 300;

// Minutes as a full-width slider from 0 to MAX_MINUTES.
export function MinutesSlider({ label, help, value, onChange }: { label: string; help: string; value: number; onChange: (value: number) => void }) {
  const id = useId();
  const [shown, setShown, commit, settle] = useSettling(value, (a, b) => a === b, onChange);
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
          {...settle}
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
// minute. Where they meet, one sits over the other, so a drag that starts there moves whichever
// thumb it heads toward, whichever input took the touch.
export function WindowSlider({ label, help, window, onChange }: { label: string; help: string; window: { min: number; max: number }; onChange: (window: { min: number; max: number }) => void }) {
  const labelId = useId();
  const [shown, setShown, commit, settle] = useSettling(window, (a, b) => a.min === b.min && a.max === b.max, onChange);
  // The window as the latest input left it, for the commit that follows.
  const next = useRef(shown);
  next.current = shown;
  // A pointer drag commits when the pointer lifts. An input standing in for the other thumb keeps
  // its own value, so it sends no change event to commit on.
  const drag = useRef<{ pointer: boolean; meeting: boolean; moves: 'min' | 'max' | null }>({ pointer: false, meeting: false, moves: null });
  const start = (event: PointerEvent) => {
    settle.onPointerDown();
    (event.currentTarget as HTMLInputElement).setPointerCapture(event.pointerId);
    drag.current = { pointer: true, meeting: shown.min === shown.max, moves: null };
  };
  // A thumb's input reads `value`. Which end of the window it moves: its own, unless the drag
  // began where the thumbs meet and headed the other thumb's way.
  const move = (own: 'min' | 'max', value: number, input: HTMLInputElement) => {
    const current = drag.current;
    if (current.moves === null && value === shown[own]) return;
    if (current.moves === null) current.moves = current.meeting && (own === 'min' ? value > shown.max : value < shown.min) ? (own === 'min' ? 'max' : 'min') : own;
    const window = current.moves === 'min' ? { min: Math.min(value, shown.max), max: shown.max } : { min: shown.min, max: Math.max(value, shown.min, 1) };
    // The input's own thumb may have gone past the other, or be standing in for it.
    input.value = String(window[own]);
    next.current = window;
    setShown(window);
  };
  const end = () => {
    drag.current = { pointer: false, meeting: false, moves: null };
    commit(next.current);
  };
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
        {(['min', 'max'] as const).map((own) => (
          <input
            key={own}
            type="range"
            min={0}
            max={MAX_MINUTES}
            step={1}
            value={shown[own]}
            aria-label={own === 'min' ? 'Shortest transfer' : 'Longest transfer'}
            aria-valuetext={spoken(shown[own])}
            onPointerDown={start}
            onPointerUp={() => drag.current.pointer && end()}
            onPointerCancel={() => drag.current.pointer && end()}
            onBlur={settle.onBlur}
            onInput={(event) => move(own, Number(event.currentTarget.value), event.currentTarget)}
            onChange={() => !drag.current.pointer && end()}
          />
        ))}
      </div>
    </div>
  );
}
