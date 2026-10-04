import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { SLIDE_MS, prefersReducedMotion, useDrag } from '../gestures.ts';
import { IconClose } from '../icons/ui.tsx';

// A drag down closes the sheet past this share of its height, or this far, whichever is less.
const CLOSE_SHARE = 1 / 3;
const CLOSE_PX = 140;
// Or when flung down at least this fast, in px per ms.
const CLOSE_FLING = 0.4;

// Modal bottom sheet: focus moves in on open, Tab stays inside, Escape and the scrim close it,
// and focus returns to the button that opened it. Dragging down closes it too, but only from
// the top of its scroll, so scrolling back up through its settings never closes it by surprise.
export function Sheet({ title, subtitle, footer, onClose, children }: { title: string; subtitle?: string; footer: ComponentChildren; onClose: () => void; children: ComponentChildren }) {
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  // Moves the panel down by offset px and fades the scrim to match. Styles are set directly, as
  // a render per touch event would lag behind the finger.
  const place = (offset: number, animated: boolean) => {
    const sheet = panel.current;
    const shade = scrim.current;
    if (!sheet || !shade) return;
    for (const element of [sheet, shade]) element.style.transition = animated ? '' : 'none';
    sheet.style.transform = offset > 0 ? `translateY(${offset}px)` : '';
    shade.style.opacity = offset > 0 ? String(Math.max(0, 1 - offset / sheet.offsetHeight)) : '';
  };
  useDrag(() => panel.current, 'y', {
    // A slider's thumb is the slider's to drag.
    claim: (direction, origin) => direction === 'down' && (panel.current?.scrollTop ?? 1) <= 0 && !origin.closest('input[type="range"]'),
    move: (dy) => place(Math.max(0, dy), false),
    end: (release) => {
      const height = panel.current?.offsetHeight ?? 0;
      if (!release || (release.distance < Math.min(height * CLOSE_SHARE, CLOSE_PX) && release.velocity < CLOSE_FLING)) return place(0, true);
      place(height, true);
      setTimeout(onClose, prefersReducedMotion() ? 0 : SLIDE_MS);
    },
  });
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => panel.current?.focus());
    return () => requestAnimationFrame(() => opener?.isConnected && opener.focus());
  }, []);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || !panel.current) return;
    const focusable = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]),select,input,[href]')];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return (
    <div class="tf-sheet">
      <div ref={scrim} class="tf-sheet__scrim" aria-hidden="true" onClick={onClose} />
      <div ref={panel} class="tf-sheet__panel" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onKeyDown={onKeyDown}>
        <div class="tf-grabber" aria-hidden="true" />
        <div class="tf-sheet__inner">
          <div class="tf-sheet__head">
            <h2>{title}</h2>
            <button type="button" class="tf-btn-icon" onClick={onClose} aria-label="Close">
              <IconClose />
            </button>
          </div>
          {subtitle && <div class="tf-sheet__subtitle">{subtitle}</div>}
          {children}
          <div class="tf-sheet__saved">{footer}</div>
          <button type="button" class="tf-btn-primary tf-sheet__done" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// A row of toggle chips. Each says its state through aria-pressed.
export function Toggle({ pressed, swatch, onToggle, children }: { pressed: boolean; swatch?: string; onToggle: () => void; children: ComponentChildren }) {
  return (
    <button type="button" class="tf-filter" aria-pressed={pressed} onClick={onToggle}>
      {swatch && <span class="tf-filter__swatch" style={{ background: swatch }} />}
      {children}
    </button>
  );
}

// One of a few options, the chosen one filled like the results page's switchers. Unlike a
// switcher the options wrap, for long labels or many choices.
export function Choices<K extends string | number>({ label, options, selected, onChoose }: { label: string; options: { key: K; text: ComponentChildren }[]; selected: K; onChoose: (key: K) => void }) {
  return (
    <div class="tf-filters" role="group" aria-label={label}>
      {options.map(({ key, text }) => (
        <button key={key} type="button" class="tf-filter tf-choice" aria-pressed={selected === key} onClick={() => onChoose(key)}>
          {text}
        </button>
      ))}
    </div>
  );
}
