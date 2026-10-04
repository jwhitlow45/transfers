import { useState } from 'preact/hooks';
import { clock } from '../format.ts';
import { IconPencil, IconTransfer, IconWarn } from '../icons/ui.tsx';
import { SAVED_COLORS } from '../lib/color.ts';
import type { NextConnection } from '../lib/summary.ts';
import { RouteChip } from './RouteChip.tsx';
import { StatusTag } from './StatusTag.tsx';

// The main daily entry point: one tap opens results, and it leads with a live countdown. The
// color stripe tells saved searches apart at a glance, and the pencil edits name and color.
export function SavedSearchCard({ name, color, chain, named, windowText, next, loading, severeAlerts, staleText, href, onOpen, onEdit, onRemove }: {
  name: string;
  color: string | undefined;
  chain: string;
  // Whether the rider gave the search its own name. Otherwise the name already is the trip.
  named: boolean;
  windowText: string | null;
  next: NextConnection | null;
  loading: boolean;
  severeAlerts: number;
  // Set when the live times behind the countdown are over a minute old.
  staleText: string | null;
  href: string;
  onOpen: () => void;
  onEdit: (change: { name: string; color: string | undefined }) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name, color });
  const done = () => {
    setEditing(false);
    onEdit({ name: draft.name.trim() || name, color: draft.color });
  };
  const now = next !== null && next.minutes < 1;
  return (
    <div class="tf-saved" style={color ? { '--saved-color': color } : undefined}>
      <div class="tf-saved__head">
        {editing ? (
          <input
            class="tf-saved__name-input"
            autoFocus
            aria-label="Saved search name"
            value={draft.name}
            onInput={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
            onKeyDown={(event) => event.key === 'Enter' && done()}
          />
        ) : (
          <h3 class="tf-saved__name">{name}</h3>
        )}
        {!editing && (
          <button
            type="button"
            class="tf-btn-icon tf-muted"
            onClick={() => {
              setDraft({ name, color });
              setEditing(true);
            }}
            aria-label={`Edit ${name}`}
          >
            <IconPencil />
          </button>
        )}
      </div>
      {editing ? (
        <div class="tf-saved__edit">
          <div class="tf-saved__swatches" role="group" aria-label="Color">
            {SAVED_COLORS.map((swatch) => (
              <button
                key={swatch.color}
                type="button"
                class="tf-swatch"
                style={{ background: swatch.color }}
                aria-label={swatch.name}
                aria-pressed={draft.color === swatch.color}
                onClick={() => setDraft({ ...draft, color: swatch.color })}
              />
            ))}
          </div>
          <div class="tf-saved__edit-actions">
            <button type="button" class="tf-btn-primary" onClick={done}>
              Done
            </button>
            <button type="button" class="tf-link-button tf-saved__remove" onClick={onRemove}>
              Remove
            </button>
          </div>
        </div>
      ) : (
        <a
          class="tf-saved__body"
          href={href}
          onClick={(event) => {
            event.preventDefault();
            onOpen();
          }}
        >
          {(named || windowText) && (
            <span class="tf-saved__chain">
              {named && <span>{chain}</span>}
              {windowText && (
                <span class="tf-saved__window">
                  <span class="tf-sr">Transfer window </span>
                  <IconTransfer />
                  {windowText}
                </span>
              )}
            </span>
          )}
          <span class="tf-saved__count">
            <span class="tf-saved__lead">{!next ? (loading ? 'Checking' : 'No connection') : now ? 'Arriving' : 'Arrives in'}</span>
            {next && <span class="tf-saved__num">{now ? 'Now' : next.minutes}</span>}
            {next && !now && <span class="tf-saved__unit">min</span>}
          </span>
          {next ? (
            <span class="tf-saved__next">
              <span class="tf-sr">{next.line}</span>
              <span class="tf-saved__legs" aria-hidden="true">
                {next.legs.map((leg, index) => (
                  <span key={index} class="tf-saved__leg">
                    {index > 0 && <span class="tf-chain__arrow">→</span>}
                    <RouteChip route={leg.route} size="sm" />
                    <span class="tf-saved__time">{clock(leg.at)}</span>
                    <StatusTag status={leg.status} plain />
                  </span>
                ))}
                {next.walk && <span class="tf-muted">No transfer needed</span>}
              </span>
            </span>
          ) : (
            <span class="tf-saved__next tf-muted">{loading ? 'Getting live predictions…' : 'Open to widen the window'}</span>
          )}
          {staleText && (
            <span class="tf-saved__stale">
              <IconWarn size={14} />
              {staleText}
            </span>
          )}
          {severeAlerts > 0 && (
            <span class="tf-saved__alert">
              <IconWarn size={14} />
              {severeAlerts === 1 ? '1 alert' : `${severeAlerts} alerts`} on your boarding stop
            </span>
          )}
        </a>
      )}
    </div>
  );
}
