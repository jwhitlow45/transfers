import { useState } from 'preact/hooks';
import { IconPencil, IconWarn } from '../icons/ui.tsx';

export type NextConnection = { minutes: number; line: string };

// The main daily entry point: one tap opens results, and it leads with a live countdown.
export function SavedSearchCard({ name, chain, windowText, next, loading, severeAlerts, href, onOpen, onRename, onRemove }: {
  name: string;
  chain: string;
  windowText: string;
  next: NextConnection | null;
  loading: boolean;
  severeAlerts: number;
  href: string;
  onOpen: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const commit = () => {
    setEditing(false);
    onRename(draft.trim() || name);
  };
  const now = next !== null && next.minutes < 1;
  return (
    <div class="tf-saved">
      <div class="tf-saved__head">
        {editing ? (
          <>
            <input
              class="tf-saved__name-input"
              autoFocus
              aria-label="Saved search name"
              value={draft}
              onInput={(event) => setDraft(event.currentTarget.value)}
              onBlur={commit}
              onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
            />
            <button type="button" class="tf-link-button tf-saved__remove" onMouseDown={(event) => event.preventDefault()} onClick={onRemove}>
              Remove
            </button>
          </>
        ) : (
          <h3 class="tf-saved__name">{name}</h3>
        )}
        {!editing && (
          <button
            type="button"
            class="tf-btn-icon tf-muted"
            onClick={() => {
              setDraft(name);
              setEditing(true);
            }}
            aria-label={`Rename or remove ${name}`}
          >
            <IconPencil />
          </button>
        )}
      </div>
      <a
        class="tf-saved__body"
        href={href}
        onClick={(event) => {
          event.preventDefault();
          onOpen();
        }}
      >
        <span class="tf-saved__chain">
          {chain} · {windowText}
        </span>
        <span class="tf-saved__count">
          <span class="tf-saved__lead">{!next ? (loading ? 'Checking' : 'No connection') : now ? 'Arriving' : 'Arrives in'}</span>
          {next && <span class="tf-saved__num">{now ? 'Now' : next.minutes}</span>}
          {next && !now && <span class="tf-saved__unit">min</span>}
        </span>
        <span class="tf-saved__next">{next ? next.line : loading ? 'Getting live predictions…' : 'Open to widen the window'}</span>
        {severeAlerts > 0 && (
          <span class="tf-saved__alert">
            <IconWarn size={14} />
            {severeAlerts === 1 ? '1 alert' : `${severeAlerts} alerts`} on your boarding stop
          </span>
        )}
      </a>
    </div>
  );
}
