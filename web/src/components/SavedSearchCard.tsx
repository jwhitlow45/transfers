import { type ComponentChildren, Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { approx, atLeast, clock } from '../format.ts';
import { IconPin, IconTransfer } from '../icons/ui.tsx';
import { SAVED_COLORS } from '../lib/color.ts';
import { type NextConnection, laterSpoken, laterText } from '../lib/summary.ts';
import { type PinAction, TimeLink } from '../track.tsx';
import { Num } from './Countdown.tsx';
import { RouteChip } from './RouteChip.tsx';
import { StatusTag, Warnline } from './StatusTag.tsx';
import { Chain, Name } from './Whole.tsx';
import { typeWithoutUndo } from '../typing.ts';
import { Cut } from './Cut.tsx';
import { keepInPlace } from '../lib/scroll.ts';

// The main daily entry point: one tap opens its page, and it leads with a live countdown. The
// color stripe tells saved searches apart at a glance. The whole card is one link, lying under
// it, and only its pin button and its times take taps of their own. It keeps its size when its
// trip is pinned, so cards never jump (J, 2026-11-09).
// While `editing`, under the Saved heading's Edit, the card shows its name, color, order and
// removal instead, each change kept as it is made.
export function SavedSearchCard({ name, color, href, openLabel, onOpen, editing, onEdit, onRemove, onMove, canMoveUp = false, canMoveDown = false, pin, children }: {
  name: string;
  color: string | undefined;
  href: string;
  // What the card's link says it opens, such as "Arrivals at Home stop".
  openLabel: string;
  onOpen: () => void;
  editing: boolean;
  onEdit: (change: { name: string; color: string | undefined }) => void;
  onRemove: () => void;
  // Reorders the saved searches. A button shows only where its move can apply.
  onMove?: (step: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  // Pins what the card shows next, there before its times arrive, if dimmed until then, so the
  // name does not rewrap when it can be used. `pinned` is whether that is the trip pinned for this
  // search, which the button then unpins and says in words. `what` names it, such as "the next
  // connection for To Mom's".
  pin?: { pinned: boolean; ready: boolean; what: string; toggle: () => void };
  // What the card shows: a trip's next connection (SavedTripBody), or a stop's arrivals.
  children: ComponentChildren;
}) {
  const card = useRef<HTMLElement>(null);
  // The name as typed, which is kept only while it is not blank.
  const [draft, setDraft] = useState(name);
  useEffect(() => {
    if (!editing) setDraft(name);
  }, [editing, name]);
  // A card saved in its route's color shows that color as one more choice, which the ten do not
  // have, so editing never hides the color it has (J, 2026-11-13). It is the color as editing
  // began, so a rider who tries another can still go back to it.
  const routeColor = useRef(offPalette(color));
  if (!editing) routeColor.current = offPalette(color);
  // Pinning puts the trip above Home's fields, and moving the card moves it, which would take the
  // card from under the rider's finger, so the page scrolls by as much, as a results row's pin does.
  // A move keeps focus on its button, or the other one once the card reaches an end.
  const inPlace = (change: () => void, refocus?: string) =>
    keepInPlace(
      () => card.current,
      change,
      (element) => refocus && (element.querySelector<HTMLElement>(`[data-move="${refocus}"]`) ?? element.querySelector<HTMLElement>('[data-move]'))?.focus(),
    );
  const stripe = color ? { '--saved-color': color } : undefined;
  if (editing) {
    return (
      <article class="tf-card tf-saved" ref={card} style={stripe} aria-label={`Edit ${name}`}>
        <div class="tf-saved__edit">
          <label class="tf-saved__name-field">
            <span class="tf-field__label">Name</span>
            <span class="tf-field__box">
            <input
              class="tf-saved__name-input"
              value={draft}
              onBeforeInput={typeWithoutUndo}
              onInput={(event) => {
                const typed = event.currentTarget.value;
                setDraft(typed);
                if (typed.trim()) onEdit({ name: typed.trim(), color });
              }}
              // Left blank, it goes back to the name it had.
              onBlur={() => setDraft(name)}
              onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
            />
            {/* The name as text over the input while the cursor is elsewhere (see .tf-field__shown). */}
            {draft && (
              <span class="tf-field__shown" aria-hidden="true">
                <Cut text={draft} />
              </span>
            )}
            </span>
          </label>
          <div class="tf-saved__swatches" role="group" aria-label={`Color of ${name}`}>
            {routeColor.current && (
              <button type="button" class="tf-swatch-route" aria-pressed={color === routeColor.current} onClick={() => onEdit({ name, color: routeColor.current })}>
                <span class="tf-swatch" style={{ background: routeColor.current }} />
                <span class="tf-swatch-route__label">Route color</span>
              </button>
            )}
            {SAVED_COLORS.map((swatch) => (
              <button key={swatch.color} type="button" class="tf-swatch" style={{ background: swatch.color }} aria-label={swatch.name} aria-pressed={color === swatch.color} onClick={() => onEdit({ name, color: swatch.color })} />
            ))}
          </div>
          <div class="tf-saved__edit-actions">
            {onMove && canMoveUp && (
              <button type="button" class="tf-textbtn" data-move="up" aria-label={`Move up: ${name}`} onClick={() => inPlace(() => onMove(-1), 'up')}>
                Move up
              </button>
            )}
            {onMove && canMoveDown && (
              <button type="button" class="tf-textbtn" data-move="down" aria-label={`Move down: ${name}`} onClick={() => inPlace(() => onMove(1), 'down')}>
                Move down
              </button>
            )}
            <button type="button" class="tf-textbtn tf-saved__remove" aria-label={`Remove ${name}`} onClick={onRemove}>
              Remove
            </button>
          </div>
        </div>
      </article>
    );
  }
  return (
    <article class="tf-card tf-saved tf-card--link" ref={card} style={stripe}>
      <div class="tf-card__head">
        <h3 class="tf-card__name">
          <Name text={name} />
        </h3>
        {pin && (
          <button
            type="button"
            class={`tf-iconbtn${pin.pinned ? ' tf-iconbtn--on' : ''}`}
            disabled={!pin.ready}
            onClick={() => pin.ready && inPlace(pin.toggle)}
            aria-pressed={pin.pinned}
            aria-label={pin.pinned ? undefined : `Pin ${pin.what}`}
          >
            <IconPin size={18} filled={pin.pinned} />
            {/* Pinned says so in words, never by the filled icon alone. */}
            {pin.pinned && (
              <>
                Pinned<span class="tf-sr">: {pin.what}</span>
              </>
            )}
          </button>
        )}
      </div>
      <a
        class="tf-card__open"
        href={href}
        onClick={(event) => {
          event.preventDefault();
          onOpen();
        }}
      >
        <span class="tf-sr">{openLabel}</span>
      </a>
      {children}
    </article>
  );
}

function offPalette(color: string | undefined) {
  return color && !SAVED_COLORS.some((swatch) => swatch.color === color.toLowerCase()) ? color : undefined;
}

// A saved trip's card body: the trip and its transfer window under the name, then the next
// connection as a row of the shared shape, with its countdown in the number column, each vehicle
// with its time and status, the transfer at the row's end, and the later connections under them.
// With no connection, it says what is wrong instead.
export function SavedTripBody({ chain, named, windowText, next, trackPin, loading, severeAlerts, nextService, staleText, unavailable = false }: {
  chain: string;
  // Whether to show the trip under the name: when the rider renamed the search, or when the trip
  // names a stop to get off at that the default name leaves out.
  named: boolean;
  windowText: string | null;
  next: NextConnection | null;
  // Pins the next connection from its map's sheet, as the results' map does (J, 2026-11-09).
  trackPin?: PinAction | undefined;
  loading: boolean;
  severeAlerts: number;
  // When the routes start again, if the answer is that none is running (summarize's nextService).
  nextService?: string | null;
  // Set when the live times behind the countdown are over a minute old.
  staleText: string | null;
  // No times to show, as the phone is offline and has none stored.
  unavailable?: boolean;
}) {
  // A vehicle yet to leave the first stop of its trip cannot be arriving now (see atLeast).
  const now = next !== null && next.minutes < 1 && !next.notStarted;
  const spoken = next && `${now ? 'Leaving now' : `In ${next.notStarted ? 'at least ' : ''}${Math.max(next.notStarted ? 1 : 0, next.minutes)} minute${next.minutes === 1 ? '' : 's'}`}: ${next.line}.${laterSpoken(next.later)}`;
  return (
    <>
      {(named || windowText || loading) && (
        <p class="tf-card__sub">
          {named && (
            <span>
              <Chain text={chain} />
            </span>
          )}
          {windowText ? (
            <span class="tf-saved__window">
              <span class="tf-sr">Transfer window </span>
              <IconTransfer size={14} />
              {windowText}
            </span>
          ) : (
            loading && <span class="tf-skeleton__text" style={{ width: '4.5em' }} />
          )}
        </p>
      )}
      {next ? (
        <div class="tf-row">
          {/* The spoken summary says everything shown, so screen readers skip the shown text and
              reach only the times, which open their vehicles' map. */}
          <span class="tf-sr">{spoken}</span>
          <Num n={now ? 'Now' : next.notStarted ? atLeast(next.minutes) : next.minutes} unit={now ? null : 'min'} />
          <div class="tf-rb">
            <div class="tf-rb__main">
              {next.legs.map((leg, index) => (
                <Fragment key={index}>
                  <div class="tf-l1">
                    <RouteChip route={leg.route} hidden />
                    <TimeLink {...next.track} {...(trackPin ? { pin: trackPin } : {})}>
                      {clock(leg.at)}
                    </TimeLink>
                  </div>
                  <div class="tf-l2" aria-hidden="true">
                    <StatusTag status={leg.status} plain />
                  </div>
                </Fragment>
              ))}
              {next.transfer === null && (
                <div class="tf-l2" aria-hidden="true">
                  No transfer needed
                </div>
              )}
              {next.later.length > 0 && (
                <div class="tf-l2" aria-hidden="true">
                  {laterText(next.later)}
                </div>
              )}
            </div>
            {next.transfer !== null && (
              <div class="tf-end" aria-hidden="true">
                <span class="tf-end__n">{approx(String(next.transfer), next.transferScheduled)}&nbsp;min</span>
                <span class="tf-end__u">transfer</span>
              </div>
            )}
          </div>
        </div>
      ) : loading ? (
        // Until the first answer, the shape of one, so the card opens at the height it keeps
        // rather than growing under the rider's thumb.
        <div class="tf-row">
          <span class="tf-sr">Getting live predictions…</span>
          <span class="tf-num" aria-hidden="true">
            <span class="tf-num__n tf-skeleton__text" style={{ width: '1.5em', height: '1em' }} />
            <span class="tf-num__u tf-skeleton__text" style={{ width: '2em' }} />
          </span>
          <div class="tf-rb" aria-hidden="true">
            <div class="tf-rb__main">
              <span class="tf-l1 tf-skeleton__text" style={{ width: '9em' }} />
              <span class="tf-l2 tf-skeleton__text" style={{ width: '5em' }} />
              <span class="tf-l1 tf-skeleton__text" style={{ width: '9em' }} />
              <span class="tf-l2 tf-skeleton__text" style={{ width: '5em' }} />
              <span class="tf-l2 tf-skeleton__text" style={{ width: '7em' }} />
            </div>
          </div>
        </div>
      ) : (
        <div class="tf-row tf-row--note">
          <div>
            <div class="tf-l1">
              <span>{unavailable ? 'Offline' : 'No connection'}</span>
            </div>
            <div class="tf-l2">{unavailable ? 'Times can’t load right now' : nextService ? `Next service ${nextService}` : 'Open to widen the window'}</div>
          </div>
        </div>
      )}
      {(staleText || severeAlerts > 0) && (
        <div class="tf-card__foot">
          {staleText && <Warnline tone="caution">{staleText}</Warnline>}
          {severeAlerts > 0 && <Warnline tone="late">{severeAlerts === 1 ? '1 alert' : `${severeAlerts} alerts`} at your boarding or transfer stop</Warnline>}
        </div>
      )}
    </>
  );
}
