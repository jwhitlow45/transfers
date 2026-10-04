import { IconSliders } from '../icons/ui.tsx';

// Thumb-reach controls on the results screen.
// windowText is null when nothing on the page has a transfer window, such as when the route
// already stops where the rider is.
export function BottomBar({ windowText, onWindow, onSettings }: { windowText: string | null; onWindow: () => void; onSettings: () => void }) {
  return (
    <nav class="tf-bottombar" aria-label="Trip controls">
      <div class="tf-bottombar__inner">
        {windowText !== null && (
          <button type="button" class="tf-btn-outline tf-bottombar__window" onClick={onWindow}>
            <span class="tf-muted">Transfer window</span>
            <strong>{windowText}</strong>
          </button>
        )}
        <button type="button" class="tf-btn-outline tf-bottombar__settings" onClick={onSettings} aria-label="Trip settings">
          <IconSliders />
        </button>
      </div>
    </nav>
  );
}
