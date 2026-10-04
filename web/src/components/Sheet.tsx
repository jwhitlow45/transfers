import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { IconClose } from '../icons/ui.tsx';

// Modal bottom sheet: focus moves in on open, Tab stays inside, Escape and the scrim close it,
// and focus returns to the button that opened it.
export function Sheet({ title, subtitle, footer, onClose, children }: { title: string; subtitle?: string; footer: ComponentChildren; onClose: () => void; children: ComponentChildren }) {
  const panel = useRef<HTMLDivElement>(null);
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
      <div class="tf-sheet__scrim" aria-hidden="true" onClick={onClose} />
      <div ref={panel} class="tf-sheet__panel" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onKeyDown={onKeyDown}>
        <div class="tf-sheet__inner">
          <div class="tf-sheet__head">
            <h2>{title}</h2>
            <button type="button" class="tf-btn-icon" onClick={onClose} aria-label="Close">
              <IconClose />
            </button>
          </div>
          {subtitle && <div class="tf-sheet__subtitle">{subtitle}</div>}
          {children}
          <button type="button" class="tf-btn-primary tf-sheet__done" onClick={onClose}>
            Done
          </button>
          <div class="tf-sheet__saved">{footer}</div>
        </div>
      </div>
    </div>
  );
}

export function Stepper({ label, help, value, min = 0, max = 60, unit = 'min', onChange }: {
  label: string;
  help: string;
  value: number;
  min?: number;
  max?: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div class="tf-setting tf-stepper-row" role="group" aria-label={label}>
      <div>
        <div class="tf-setting__label">{label}</div>
        <div class="tf-setting__help">{help}</div>
      </div>
      <div class="tf-stepper">
        <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`Less: ${label}`}>
          −
        </button>
        <output aria-live="polite">
          {value} {unit}
        </output>
        <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`More: ${label}`}>
          +
        </button>
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
