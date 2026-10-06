import { useState } from 'preact/hooks';
import { motionOff } from '../gestures.ts';
import { IconChevron, IconInfo, IconWarn } from '../icons/ui.tsx';
import type { ViewAlert } from '../lib/alerts.ts';
import { Collapse } from './Collapse.tsx';

// Inline, collapsible, ordered by importance. Alerts on the rider's boarding stop open at first.
// Folded, each is one line, since riders often have a notice from each agency above their
// results. Opened, each can be dismissed, and the Notices page puts it back.
export function AlertList({ alerts, onDismiss }: { alerts: ViewAlert[]; onDismiss: (alert: ViewAlert) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(alerts.filter(({ startOpen }) => startOpen).map(({ id }) => [id, true])));
  // A dismissed notice closes as a folded one does before it goes, so what is below slides up
  // rather than jumping.
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const dismiss = (alert: ViewAlert) => {
    setLeaving((current) => new Set([...current, alert.id]));
    setTimeout(
      () => {
        onDismiss(alert);
        setLeaving((current) => new Set([...current].filter((id) => id !== alert.id)));
      },
      motionOff() ? 0 : LEAVE_MS,
    );
  };
  if (alerts.length === 0) return null;
  return (
    <section class="tf-alerts" aria-label="Service alerts">
      {alerts.map((alert) => {
        const isOpen = open[alert.id] ?? alert.startOpen;
        const panel = `alert-${alert.id.replace(/[^\w-]/g, '_')}`;
        return (
          <Collapse key={alert.id} open={!leaving.has(alert.id)}>
            <div class={`tf-alert tf-alert--${alert.severity}`} data-open={String(isOpen)}>
              <button type="button" class="tf-alert__toggle" aria-expanded={isOpen} aria-controls={panel} onClick={() => setOpen((current) => ({ ...current, [alert.id]: !isOpen }))}>
                <span class="tf-alert__icon">{alert.severity === 'info' ? <IconInfo /> : <IconWarn />}</span>
                <span class="tf-alert__text">
                  <span class="tf-kicker">{alert.kicker}</span>
                  <span class="tf-alert__sep" aria-hidden="true">
                    ·
                  </span>
                  <span class="tf-alert__title">{alert.title}</span>
                </span>
                <span class="tf-alert__chev">
                  <IconChevron />
                </span>
              </button>
              <Collapse open={isOpen} id={panel}>
                <div class="tf-alert__body">
                  {alert.body}
                  <div class="tf-alert__foot">
                    <div class="tf-alert__meta">
                      <span>{alert.meta}</span>
                      {alert.url && (
                        <a href={alert.url} target="_blank" rel="noopener">
                          More from the agency
                        </a>
                      )}
                    </div>
                    <button type="button" class="tf-btn-outline tf-btn-secondary tf-alert__dismiss" aria-label={`Dismiss notice: ${alert.kicker}, ${alert.title}`} onClick={() => dismiss(alert)}>
                      Dismiss
                    </button>
                  </div>
                </div>
              </Collapse>
            </div>
          </Collapse>
        );
      })}
    </section>
  );
}

// As long as a section takes to close (--motion-fast in styles.css).
const LEAVE_MS = 150;
