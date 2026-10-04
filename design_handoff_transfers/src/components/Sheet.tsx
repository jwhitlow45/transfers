import { useEffect, useRef } from 'react';
import { IconClose } from '../icons/ui';

/** Modal bottom sheet: focus moves in on open, Tab stays inside, Escape and scrim close, focus returns to the opener. */
export function Sheet({ title, subtitle, savedWith, onClose, children }: { title: string; subtitle?: string; savedWith: string; onClose: () => void; children: React.ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => opener?.focus?.();
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key !== 'Tab' || !panel.current) return;
    const f = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]),select,input,[href]')];
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1], at = document.activeElement;
    if (e.shiftKey && (at === first || at === panel.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <div className="tf-sheet">
      <div className="tf-sheet__scrim" aria-hidden="true" onClick={onClose} />
      <div ref={panel} className="tf-sheet__panel" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onKeyDown={onKeyDown} style={{ outline: 'none' }}>
        <div className="tf-sheet__inner">
          <div className="tf-sheet__head"><h2>{title}</h2><button className="tf-btn-icon" onClick={onClose} aria-label="Close"><IconClose /></button></div>
          {subtitle && <div className="tf-muted" style={{ fontSize: 'var(--text-base)' }}>{subtitle}</div>}
          {children}
          <button className="tf-btn-primary" style={{ marginTop: 'var(--space-3)' }} onClick={onClose}>Done</button>
          <div className="tf-sheet__saved">Saved with “{savedWith}”</div>
        </div>
      </div>
    </div>
  );
}

export function Stepper({ label, help, value, min = 0, max = 60, onChange }: { label: string; help: string; value: number; min?: number; max?: number; onChange: (v: number) => void }) {
  return (
    <div className="tf-setting tf-stepper-row" role="group" aria-label={label}>
      <div><div className="tf-setting__label">{label}</div><div className="tf-setting__help">{help}</div></div>
      <div className="tf-stepper">
        <button onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`Less: ${label}`}>−</button>
        <output aria-live="polite">{value} min</output>
        <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`More: ${label}`}>+</button>
      </div>
    </div>
  );
}
