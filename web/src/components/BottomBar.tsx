import { IconSliders } from '../icons/ui.tsx';

// Thumb-reach controls on the results screen.
export function BottomBar({ windowText, onWindow, onSettings }: { windowText: string; onWindow: () => void; onSettings: () => void }) {
  return (
    <nav class="tf-bottombar" aria-label="Trip controls">
      <div class="tf-bottombar__inner">
        <button type="button" class="tf-btn-outline tf-bottombar__window" onClick={onWindow}>
          <span class="tf-muted">Transfer window</span>
          <strong>{windowText}</strong>
        </button>
        <button type="button" class="tf-btn-outline tf-bottombar__settings" onClick={onSettings} aria-label="Trip settings">
          <IconSliders />
        </button>
      </div>
    </nav>
  );
}
