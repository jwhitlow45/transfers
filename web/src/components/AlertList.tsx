import { useRef, useState } from 'preact/hooks';
import { focusInstead } from '../focus.ts';
import { motionOff } from '../gestures.ts';
import { navigate } from '../router.ts';
import { IconChevron, IconChevronRight, IconInfo, IconWarn } from '../icons/ui.tsx';
import { NOTICE, type ViewAlert } from '../lib/alerts.ts';
import { Collapse } from './Collapse.tsx';

// Inline, collapsible, ordered by importance. Alerts on the rider's boarding stop open at first.
// Folded, each is one line, since riders often have a notice from each agency above their
// results. Opened, each can be dismissed, and the Notices page puts it back. The list ends in a
// quieter row counting this trip's dismissed notices, which opens that page, and holds the
// notices' place when every one is dismissed.
export function AlertList({ alerts, dismissed, onDismiss }: { alerts: ViewAlert[]; dismissed: number; onDismiss: (alert: ViewAlert) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(alerts.filter(({ startOpen }) => startOpen).map(({ id }) => [id, true])));
  // A dismissed notice closes as a folded one does before it goes, so what is below slides up
  // rather than jumping.
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const section = useRef<HTMLElement>(null);
  const dismiss = (alert: ViewAlert) => {
    const place = alerts.indexOf(alert);
    setLeaving((current) => new Set([...current, alert.id]));
    setTimeout(
      () => {
        onDismiss(alert);
        setLeaving((current) => new Set([...current].filter((id) => id !== alert.id)));
        // Focus goes to what takes the notice's place: the next one, or the row counting dismissed
        // ones.
        requestAnimationFrame(() => {
          const rows = section.current?.querySelectorAll<HTMLElement>('.tf-alert__toggle, .tf-alert--dismissed') ?? [];
          if (!document.activeElement || document.activeElement === document.body) focusInstead(rows[Math.min(place, rows.length - 1)]);
        });
      },
      motionOff() ? 0 : LEAVE_MS,
    );
  };
  if (alerts.length === 0 && dismissed === 0) return null;
  return (
    <section ref={section} class="tf-alerts" aria-label="Service alerts">
      {alerts.map((alert) => {
        const isOpen = open[alert.id] ?? alert.startOpen;
        const panel = `alert-${alert.id.replace(/[^\w-]/g, '_')}`;
        return (
          <Collapse key={alert.id} open={!leaving.has(alert.id)}>
            <div class={`tf-alert tf-alert--${alert.severity}`} data-open={String(isOpen)}>
              <button type="button" class="tf-alert__toggle" aria-expanded={isOpen} aria-controls={panel} onClick={() => setOpen((current) => ({ ...current, [alert.id]: !isOpen }))}>
                <span class="tf-alert__icon">{alert.severity === 'info' ? <IconInfo /> : <IconWarn />}</span>
                <span class="tf-alert__text">
                  <span class="tf-kicker">
                    {/* Narrow screens leave out the plain word "Notice" from a folded one's
                        kicker, so more of the title shows (see styles.css). */}
                    {alert.kicker.startsWith(NOTICE) ? (
                      <>
                        <span class="tf-alert__notice">{NOTICE}</span>
                        {alert.kicker.slice(NOTICE.length)}
                      </>
                    ) : (
                      alert.kicker
                    )}
                  </span>
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
      {dismissed > 0 && (
        <a class="tf-alert tf-alert--dismissed" href="/notices" onClick={(event) => (event.preventDefault(), navigate('/notices'))}>
          <span class="tf-alert__icon">
            <IconInfo />
          </span>
          <span class="tf-kicker">{dismissed === 1 ? '1 dismissed notice' : `${dismissed} dismissed notices`}</span>
          <span class="tf-alert__chev">
            <IconChevronRight />
          </span>
        </a>
      )}
    </section>
  );
}

// As long as a section takes to close (--motion-fast in styles.css).
const LEAVE_MS = 150;
