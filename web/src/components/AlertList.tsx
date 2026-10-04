import { useState } from 'preact/hooks';
import { IconChevron, IconInfo, IconWarn } from '../icons/ui.tsx';
import type { ViewAlert } from '../lib/alerts.ts';
import { Collapse } from './Collapse.tsx';

// Inline, collapsible, ordered by importance. Alerts on the rider's boarding stop are severe
// and open by default.
export function AlertList({ alerts }: { alerts: ViewAlert[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(alerts.filter(({ severity }) => severity === 'severe').map(({ id }) => [id, true])));
  if (alerts.length === 0) return null;
  return (
    <section class="tf-alerts" aria-label="Service alerts">
      {alerts.map((alert) => {
        const isOpen = open[alert.id] ?? alert.severity === 'severe';
        const panel = `alert-${alert.id.replace(/[^\w-]/g, '_')}`;
        return (
          <div key={alert.id} class={`tf-alert tf-alert--${alert.severity}`} data-open={String(isOpen)}>
            <button type="button" class="tf-alert__toggle" aria-expanded={isOpen} aria-controls={panel} onClick={() => setOpen((current) => ({ ...current, [alert.id]: !isOpen }))}>
              <span class="tf-alert__icon">{alert.severity === 'info' ? <IconInfo /> : <IconWarn />}</span>
              <span class="tf-alert__text">
                <span class="tf-kicker">{alert.kicker}</span>
                <span class="tf-alert__title">{alert.title}</span>
              </span>
              <span class="tf-alert__chev">
                <IconChevron />
              </span>
            </button>
            <Collapse open={isOpen} id={panel}>
              <div class="tf-alert__body">
                {alert.body}
                <div class="tf-alert__meta">
                  {alert.meta}
                  {alert.url && (
                    <>
                      {' · '}
                      <a href={alert.url} target="_blank" rel="noopener">
                        More from the agency
                      </a>
                    </>
                  )}
                </div>
              </div>
            </Collapse>
          </div>
        );
      })}
    </section>
  );
}
