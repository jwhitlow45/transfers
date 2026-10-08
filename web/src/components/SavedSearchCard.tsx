import { useState } from 'preact/hooks';
import { clock } from '../format.ts';
import { IconPencil, IconPin, IconTransfer, IconWarn } from '../icons/ui.tsx';
import { SAVED_COLORS } from '../lib/color.ts';
import type { Pin } from '../storage.ts';
import type { NextConnection } from '../lib/summary.ts';
import { RouteChip } from './RouteChip.tsx';
import { StatusTag } from './StatusTag.tsx';
import { typeWithoutUndo } from '../typing.ts';

// The main daily entry point: one tap opens results, and it leads with a live countdown. The
// color stripe tells saved searches apart at a glance, and the pencil edits name and color.
export function SavedSearchCard({ name, color, chain, named, windowText, next, loading, severeAlerts, nextService, staleText, href, onOpen, onEdit, onRemove, onMove, canMoveUp = false, canMoveDown = false, onPin }: {
  name: string;
  color: string | undefined;
  chain: string;
  // Whether to show the trip under the name: when the rider renamed the search, or when the trip
  // names a stop to get off at that the default name leaves out.
  named: boolean;
  windowText: string | null;
  next: NextConnection | null;
  loading: boolean;
  severeAlerts: number;
  // When the routes start again, if the answer is that none is running (summarize's nextService).
  nextService?: string | null;
  // Set when the live times behind the countdown are over a minute old.
  staleText: string | null;
  href: string;
  onOpen: () => void;
  onEdit: (change: { name: string; color: string | undefined }) => void;
  onRemove: () => void;
  // Reorders the saved searches. A button shows only where its move can apply.
  onMove?: (step: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  // Pins the connection the card shows.
  onPin?: (pin: Pin) => void;
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
            onBeforeInput={typeWithoutUndo}
            onInput={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
            onKeyDown={(event) => event.key === 'Enter' && done()}
          />
        ) : (
          <h3 class="tf-saved__name">{name}</h3>
        )}
        {!editing && next && onPin && (
          <button type="button" class="tf-btn-icon tf-muted" onClick={() => onPin(next.pin)} aria-label={`Pin the next connection for ${name}`}>
            <IconPin />
          </button>
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
          {onMove && (canMoveUp || canMoveDown) && (
            <div class="tf-saved__order">
              {canMoveUp && (
                <button type="button" class="tf-link-button" onClick={() => onMove(-1)}>
                  Move up
                </button>
              )}
              {canMoveDown && (
                <button type="button" class="tf-link-button" onClick={() => onMove(1)}>
                  Move down
                </button>
              )}
            </div>
          )}
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
          {(named || windowText || loading) && (
            <span class="tf-saved__chain">
              {named && <span>{chain}</span>}
              {windowText ? (
                <span class="tf-saved__window">
                  <span class="tf-sr">Transfer window </span>
                  <IconTransfer />
                  {windowText}
                </span>
              ) : (
                loading && <span class="tf-skeleton__text" style={{ width: '4.5em' }} />
              )}
            </span>
          )}
          {/* The countdown column of a results row, with the connection to its right: each vehicle
              on a line of its own, and the transfer between them, so nothing wraps. */}
          <span class="tf-saved__row">
            <span class="tf-saved__count">
              <span class="tf-row__lead">{!next ? (loading ? 'Checking' : 'No connection') : now ? 'Arriving' : 'Arrives in'}</span>
              {next && <span class="tf-row__num">{now ? 'Now' : next.minutes}</span>}
              {loading && <span class="tf-row__num tf-skeleton__text" style={{ width: '1.3em', height: '1em' }} />}
              {/* Most answers are minutes away, with "min" under the number. */}
              {loading && <span class="tf-row__unit tf-skeleton__text" style={{ width: '2em' }} />}
              {next && !now && <span class="tf-row__unit">min</span>}
            </span>
            {next ? (
              <span class="tf-saved__next">
                <span class="tf-sr">{next.line}</span>
                <span class="tf-saved__drawn" aria-hidden="true">
                  {next.legs.map((leg, index) => [
                    index > 0 && next.transfer !== null && (
                      <span key={`xfer${index}`} class="tf-saved__xfer">
                        <IconTransfer />
                        {next.transfer} min transfer
                      </span>
                    ),
                    <span key={`leg${index}`} class="tf-saved__leg">
                      <RouteChip route={leg.route} size="sm" />
                      <span class="tf-saved__time">{clock(leg.at)}</span>
                      <StatusTag status={leg.status} plain />
                    </span>,
                  ])}
                  {next.transfer === null && <span class="tf-saved__xfer">No transfer needed</span>}
                  {next.later.length > 0 && <span class="tf-saved__then">then {next.later.join(', ')} min</span>}
                </span>
              </span>
            ) : loading ? (
              // Until the first answer, the shape of one, so the card opens at the height it keeps
              // rather than growing under the rider's thumb.
              <span class="tf-saved__next">
                <span class="tf-sr">Getting live predictions…</span>
                <span class="tf-saved__drawn" aria-hidden="true">
                  <span class="tf-saved__time tf-skeleton__text" style={{ width: '10em' }} />
                  <span class="tf-saved__xfer tf-skeleton__text" style={{ width: '9em' }} />
                  <span class="tf-saved__time tf-skeleton__text" style={{ width: '10em' }} />
                </span>
              </span>
            ) : (
              <span class="tf-saved__next tf-muted">{nextService ? `Next service ${nextService}` : 'Open to widen the window'}</span>
            )}
          </span>
          {staleText && (
            <span class="tf-saved__stale">
              <IconWarn size={14} />
              {staleText}
            </span>
          )}
          {severeAlerts > 0 && (
            <span class="tf-saved__alert">
              <IconWarn size={14} />
              {severeAlerts === 1 ? '1 alert' : `${severeAlerts} alerts`} at your boarding or transfer stop
            </span>
          )}
        </a>
      )}
    </div>
  );
}
