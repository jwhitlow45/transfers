import { useState } from 'react';
import { IconChevron, IconInfo, IconWarn } from '../icons/ui';
import type { ServiceAlert } from '../types';

/** Inline, collapsible, ordered by importance. Alerts on the rider's boarding stop are severe and open by default. */
export function AlertList({ alerts, initiallyOpen }: { alerts: ServiceAlert[]; initiallyOpen?: string[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries((initiallyOpen ?? alerts.filter(a => a.severity === 'severe').map(a => a.id)).map(id => [id, true])));
  if (!alerts.length) return null;
  return (
    <section className="tf-alerts" aria-label="Service alerts">
      {alerts.map(a => {
        const isOpen = !!open[a.id];
        return (
          <div key={a.id} className={`tf-alert tf-alert--${a.severity}`} data-open={isOpen}>
            <button className="tf-alert__toggle" aria-expanded={isOpen} aria-controls={`alert-${a.id}`} onClick={() => setOpen(o => ({ ...o, [a.id]: !o[a.id] }))}>
              <span className="tf-alert__icon">{a.severity === 'info' ? <IconInfo /> : <IconWarn />}</span>
              <span className="tf-alert__text"><span className="tf-kicker">{a.kicker}</span><span className="tf-alert__title">{a.title}</span></span>
              <span className="tf-alert__chev"><IconChevron /></span>
            </button>
            {isOpen && <div id={`alert-${a.id}`} className="tf-alert__body">{a.body}<div className="tf-alert__meta">{a.meta}</div></div>}
          </div>
        );
      })}
    </section>
  );
}
