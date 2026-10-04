import { useState } from 'react';
import { IconPencil, IconWarn } from '../icons/ui';

export interface SavedSearchCardProps {
  name: string;
  chain: string;               // "Montgomery → 24th St Mission → 48"
  windowText: string;
  next?: { minutes: number; line: string };   // soonest connecting first vehicle; line includes both legs' lateness
  severeAlerts: number;
  onOpen: () => void;
  onRename: (name: string) => void;
}

/** Primary daily entry point: one tap opens results; leads with a live countdown. */
export function SavedSearchCard({ name, chain, windowText, next, severeAlerts, onOpen, onRename }: SavedSearchCardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const commit = () => { setEditing(false); onRename(draft.trim() || name); };
  const now = next && next.minutes < 1;
  return (
    <div className="tf-saved">
      <div className="tf-saved__head">
        {editing
          ? <input className="tf-saved__name-input" autoFocus aria-label="Saved search name" value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          : <h3 className="tf-saved__name">{name}</h3>}
        <button className="tf-btn-icon tf-muted" onClick={() => { setDraft(name); setEditing(true); }} aria-label={`Rename ${name}`}><IconPencil /></button>
      </div>
      <button className="tf-saved__body" onClick={onOpen}>
        <span className="tf-saved__chain">{chain} · {windowText}</span>
        <span className="tf-saved__count">
          <span className="tf-saved__lead">{!next ? 'No connection' : now ? 'Arriving' : 'Arrives in'}</span>
          {next && <span className="tf-saved__num">{now ? 'Now' : next.minutes}</span>}
          {next && !now && <span className="tf-saved__unit">min</span>}
        </span>
        <span className="tf-saved__next">{next ? next.line : 'Open to widen the window'}</span>
        {severeAlerts > 0 && <span className="tf-saved__alert"><IconWarn size={14} />{severeAlerts} alert on your boarding stop</span>}
      </button>
    </div>
  );
}
