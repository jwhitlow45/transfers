import type { ComponentChildren } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { clock } from '../format.ts';
import { IconPencil, IconPin, IconTransfer } from '../icons/ui.tsx';
import { SAVED_COLORS } from '../lib/color.ts';
import type { NextConnection } from '../lib/summary.ts';
import { RouteChip } from './RouteChip.tsx';
import { Flag, StatusTag } from './StatusTag.tsx';
import { typeWithoutUndo } from '../typing.ts';
import { keepInPlace } from '../lib/scroll.ts';

// The main daily entry point: one tap opens results, and it leads with a live countdown. The
// color stripe tells saved searches apart at a glance, and the pencil edits name and color.
export function SavedSearchCard({ name, color, href, onOpen, onEdit, onRemove, onMove, canMoveUp = false, canMoveDown = false, pin, children }: {
  name: string;
  color: string | undefined;
  href: string;
  onOpen: () => void;
  onEdit: (change: { name: string; color: string | undefined }) => void;
  onRemove: () => void;
  // Reorders the saved searches. A button shows only where its move can apply.
  onMove?: (step: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  // Pins what the card shows next, there before its times arrive, if dimmed until then, so the
  // name does not rewrap when it can be used. `pinned` is whether that is the trip pinned for this
  // search, which the button then unpins.
  pin?: { pinned: boolean; ready: boolean; label: string; toggle: () => void };
  // What the card shows, which opens its page: a trip's next connection (SavedTripBody), or a
  // stop's arrivals.
  children: ComponentChildren;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name, color });
  const card = useRef<HTMLDivElement>(null);
  const done = () => {
    setEditing(false);
    onEdit({ name: draft.name.trim() || name, color: draft.color });
  };
  // Escape leaves the panel as the card was.
  const cancel = () => setEditing(false);
  // Pinning puts the trip above Home's fields, and moving the card moves it, which would take the
  // card from under the rider's finger, so the page scrolls by as much, as a results row's pin does.
  // A move keeps focus on its button, or the other one once the card reaches an end.
  const inPlace = (change: () => void, refocus?: string) =>
    keepInPlace(
      () => card.current,
      change,
      (element) => refocus && (element.querySelector<HTMLElement>(`[data-move="${refocus}"]`) ?? element.querySelector<HTMLElement>('[data-move]'))?.focus(),
    );
  // The color picked shows on the card's stripe while the rider picks.
  const shownColor = editing ? draft.color : color;
  return (
    <div class="tf-saved" ref={card} style={shownColor ? { '--saved-color': shownColor } : undefined}>
      <div class="tf-saved__head">
        {editing ? (
          <input
            class="tf-saved__name-input"
            autoFocus
            aria-label="Saved search name"
            value={draft.name}
            onBeforeInput={typeWithoutUndo}
            onInput={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
            onKeyDown={(event) => (event.key === 'Enter' ? done() : event.key === 'Escape' && cancel())}
          />
        ) : (
          <h3 class="tf-saved__name">{name}</h3>
        )}
        {!editing && pin && (
          <button
            type="button"
            class={`tf-btn-icon ${pin.pinned ? 'tf-saved__pinned' : 'tf-muted'}`}
            disabled={!pin.ready}
            onClick={() => pin.ready && inPlace(pin.toggle)}
            aria-pressed={pin.pinned}
            aria-label={pin.label}
          >
            <IconPin size={18} filled={pin.pinned} />
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
            <IconPencil size={18} />
          </button>
        )}
      </div>
      {editing ? (
        <div class="tf-saved__edit" onKeyDown={(event) => event.key === 'Escape' && cancel()}>
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
                <button type="button" class="tf-link-button" data-move="up" onClick={() => inPlace(() => onMove(-1), 'up')}>
                  Move up
                </button>
              )}
              {canMoveDown && (
                <button type="button" class="tf-link-button" data-move="down" onClick={() => inPlace(() => onMove(1), 'down')}>
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
          {children}
        </a>
      )}
    </div>
  );
}

// A saved trip's card body: the next connection as a countdown, with later ones under it, each
// vehicle and the transfer between them, and what is wrong when there is none.
export function SavedTripBody({ chain, named, windowText, next, loading, severeAlerts, nextService, staleText, unavailable = false }: {
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
  // No times to show, as the phone is offline and has none stored.
  unavailable?: boolean;
}) {
  const now = next !== null && next.minutes < 1;
  return (
    <>
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
          <span class="tf-row__lead">{!next ? (loading ? 'Checking' : unavailable ? 'Offline' : 'No connection') : now ? 'Arriving' : 'Arrives in'}</span>
          {next && (
            <span class="tf-saved__amount">
              <span class="tf-row__num">{now ? 'Now' : next.minutes}</span>
              {!now && <span class="tf-row__unit">min</span>}
            </span>
          )}
          {loading && <span class="tf-row__num tf-skeleton__text" style={{ width: '2em', height: '1em' }} />}
          {loading && <span class="tf-saved__then tf-skeleton__text" style={{ width: '5em' }} />}
          {/* Under the countdown it goes on from, not under the transfer, which it would seem
              to be about there, on one line, as the "min" above it says what the numbers are
              (J, 2026-10-08). */}
          {next && next.later.length > 0 && (
            <span class="tf-saved__then">
              then {next.later.join(', ')}
              <span class="tf-sr"> min</span>
            </span>
          )}
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
            </span>
          </span>
        ) : loading ? (
          // Until the first answer, the shape of one, so the card opens at the height it keeps
          // rather than growing under the rider's thumb.
          <span class="tf-saved__next">
            <span class="tf-sr">Getting live predictions…</span>
            <span class="tf-saved__drawn" aria-hidden="true">
              <span class="tf-saved__time tf-skeleton__text" style={{ width: '10em' }} />
              <span class="tf-saved__time tf-skeleton__text tf-saved__status-line" style={{ width: '5em' }} />
              <span class="tf-saved__xfer tf-skeleton__text" style={{ width: '9em' }} />
              <span class="tf-saved__time tf-skeleton__text" style={{ width: '10em' }} />
              <span class="tf-saved__time tf-skeleton__text tf-saved__status-line" style={{ width: '5em' }} />
            </span>
          </span>
        ) : (
          <span class="tf-saved__next tf-muted">
            {unavailable ? 'Times can’t load right now' : nextService ? `Next service ${nextService}` : 'Open to widen the window'}
          </span>
        )}
      </span>
      {staleText && (
        <Flag tone="caution" class="tf-saved__stale">
          {staleText}
        </Flag>
      )}
      {severeAlerts > 0 && (
        <Flag tone="late" class="tf-saved__alert">
          {severeAlerts === 1 ? '1 alert' : `${severeAlerts} alerts`} at your boarding or transfer stop
        </Flag>
      )}
    </>
  );
}
