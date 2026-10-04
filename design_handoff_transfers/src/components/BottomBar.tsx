import { IconSliders } from '../icons/ui';

/** Thumb-reach controls on the results screen. */
export function BottomBar({ windowText, onWindow, onSettings }: { windowText: string; onWindow: () => void; onSettings: () => void }) {
  return (
    <nav className="tf-bottombar" aria-label="Trip controls">
      <div className="tf-bottombar__inner">
        <button className="tf-btn-outline tf-bottombar__window" onClick={onWindow}><span className="tf-muted">Transfer window</span><strong>{windowText}</strong></button>
        <button className="tf-btn-outline tf-bottombar__settings" onClick={onSettings} aria-label="Trip settings"><IconSliders /></button>
      </div>
    </nav>
  );
}
