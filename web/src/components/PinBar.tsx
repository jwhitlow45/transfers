import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Alert, PinnedLeg, PinnedStop, StopResponse, TripResponse } from '../../../shared/api.ts';
import { tripPath } from '../../../shared/paths.ts';
import { apiUrl } from '../api.ts';
import { approx, clock, hasLeft, minuteCount, minutesUntil, stillWaiting, walkMinutes } from '../format.ts';
import { useNow, usePinnedTrip, usePoll, useStopPin } from '../hooks.ts';
import { IconChevron, IconClose, IconFullRoute, IconWarn } from '../icons/ui.tsx';
import { ScreenActive } from '../layers.ts';
import { titleAndBody } from '../lib/alerts.ts';
import { ringsBell } from '../lib/eggs.ts';
import { liveClock, liveNote } from '../lib/freshness.ts';
import { type PinMap, type RankedPin, alertStops, pinFocus, pinMap, pinVerb, restOfTrip, shownPin, tripCountdown, tripMinutes, tripMinutesText, tripStatusText, vehicleWord } from '../lib/pin-bar.ts';
import { pinnedDestination, pinnedPhase, pinnedTransfer, scheduledAt } from '../lib/pinned.ts';
import { pageColors } from '../lib/results.ts';
import { arrivalAlerts, arrivalCountdown, pinnedArrival } from '../lib/stop-pins.ts';
import { stopAlerts, summarize } from '../lib/summary.ts';
import { changePin, onPinToast, pinId, setPin, usePinRefresh, usePins } from '../pins.ts';
import { type Page, resultsPath, stopPath } from '../router.ts';
import { useSettings } from '../settings.tsx';
import { type Pin, type Search, loadDismissed, loadSaved } from '../storage.ts';
import { type PinAction, TimeLink } from '../track.tsx';
import { chipLabel, pinLabel, shortStopName, statusAt, vehicleAt } from '../view.ts';
import { AppLink } from './AppLink.tsx';
import { Num } from './Countdown.tsx';
import { RouteChip } from './RouteChip.tsx';
import { Approx, StatusTag, Warnline } from './StatusTag.tsx';
import { Dots } from './Dots.tsx';
import { Toast, useToast } from './Toast.tsx';
import './PinBar.css';

// What each pin tells the bar: how urgent it is (see shownPin), its tab's countdown, the step it
// is on, with the words that say a new one, and the caution its times carry when they are not live.
type PinReport = RankedPin & { tab: string; step: string | null; says: string; stale: string | null };
type Report = (id: string, report: PinReport | null) => void;
type StoredPin = Pin & { search: Search };

const PANEL = 'pin-panel';
const VIEW = 'pin-view';
const tabId = (id: string) => `pin-tab-${id.replace(/[^\w-]/g, '_')}`;

// The pins, as one bar that belongs to the app: the same element in the same place on every page
// but Settings, like a media player's mini bar, and gone with nothing pinned. It lives outside the
// screens' layers (see main.tsx), so it stays put as pages slide and scroll. Shut, it is one row of
// the shape every row has, counting down to what the rider does next. Open, a panel drops over the
// page with the rest of the trip, and opening the pin's page, its live map, and Unpin. With several
// pins, a tab each sits under the bar, which shows the most urgent until the rider taps one.
// Each pin polls here, once, wherever the rider is, and again on Home's pull to refresh (see
// usePinRefresh), and the bar alone keeps a pin's times and
// unpins it once it has ended (see useKeptPin in hooks.ts).
// `open` is the panel showing, which the app holds so it can make the page behind inert.
export function PinBar({ page, open, onOpen }: { page: Page; open: boolean; onOpen: (open: boolean) => void }) {
  const pins = usePins();
  const hidden = page.name === 'settings';
  const [reports, setReports] = useState<Record<string, PinReport>>({});
  const report: Report = useCallback((id, next) => setReports(({ [id]: _old, ...others }) => (next ? { ...others, [id]: next } : others)), []);
  // The tab the rider tapped, kept until that pin ends.
  const [chosen, setChosen] = useState<string | null>(null);
  const ranked = pins.map((pin) => reports[pinId(pin)] ?? { id: pinId(pin), at: null, ended: false });
  const shown = shownPin(ranked, chosen);
  useEffect(() => {
    if (shown.chosen !== chosen) setChosen(shown.chosen);
  }, [shown.chosen]);

  // The status line: what a screen reader hears of the bar without asking. A new step of the trip
  // showing, a toast's words, and the caution on times that are not live, once. Never a countdown's
  // tick. The count makes the same words, said again, a change to announce.
  const [said, setSaid] = useState({ text: '', count: 0 });
  const say = (text: string) => setSaid(({ count }) => ({ text, count: count + 1 }));
  const before = useRef<Record<string, { step: string | null; stale: boolean }>>({});
  useEffect(() => {
    const seen = before.current;
    before.current = {};
    for (const { id, step, says, stale } of Object.values(reports)) {
      const last = seen[id];
      if (id === shown.id && !hidden) {
        if (last?.step && step && step !== last.step) say(says);
        else if (stale && !last?.stale) say(stale);
      }
      // A pin not showing has said nothing yet, so its caution waits until it shows.
      before.current[id] = { step, stale: id === shown.id ? stale !== null : (last?.stale ?? false) };
    }
  }, [reports, shown.id, hidden]);

  // The one toast for pins, wherever one was changed from: above the page's bottom bar, never over
  // this bar, and said through the status line here (J, 2026-11-09).
  const { toast, show, clear } = useToast();
  const [above, setAbove] = useState(0);
  useEffect(
    () =>
      onPinToast((next) => {
        setAbove(document.querySelector<HTMLElement>('.tf-app > .tf-layer > .tf-bottombar')?.offsetHeight ?? 0);
        show(next);
        say(next.text);
      }),
    [],
  );

  const bar = useRef<HTMLElement>(null);
  const main = () => bar.current?.querySelector<HTMLElement>('.tf-pinbar__main');
  const close = () => {
    onOpen(false);
    main()?.focus();
  };
  // Opened, focus moves into the panel, so a screen reader starts at its top.
  useEffect(() => {
    if (open) bar.current?.querySelector<HTMLElement>(`#${PANEL}`)?.focus({ preventScroll: true });
  }, [open]);
  // It shuts when the rider goes to another page, as by Open trip, and with nothing left to show.
  const present = pins.length > 0 && !hidden;
  useEffect(() => {
    if (open) onOpen(false);
  }, [page, present]);

  useBarPlace(bar, present, page);

  // The status line outlives the bar, so it can say the last pin was unpinned.
  const status = (
    <p key="status" class="tf-sr" role="status">
      {said.text}
      {said.count % 2 ? '\u200b' : ''}
    </p>
  );
  if (pins.length === 0) {
    return (
      <>
        {status}
        <Toast key="toast" message={toast} page above={above} quiet onDone={clear} />
      </>
    );
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (!open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      return close();
    }
    // Open, Tab stays in the bar and its panel, as the page behind is inert.
    if (event.key !== 'Tab' || !bar.current) return;
    const focusable = [...bar.current.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]),[href]')].filter((element) => element.offsetParent !== null);
    const first = focusable[0];
    const last = focusable.at(-1);
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !focusable.includes(active as HTMLElement))) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  const saved = loadSaved();
  const dismissed = new Set(loadDismissed().map(({ id }) => id));
  const many = pins.length > 1;
  const stale = shown.id ? (reports[shown.id]?.stale ?? null) : null;
  const feeds = pins.map((pin) => {
    const id = pinId(pin);
    const Feed = pin.arrival ? StopFeed : TripFeed;
    return (
      <Feed
        key={id}
        pin={pin}
        name={saved.find((item) => item.id === id)?.name}
        dismissed={dismissed}
        shown={id === shown.id}
        open={open && id === shown.id}
        onReport={report}
        onToggle={() => onOpen(!open)}
        onClose={close}
      />
    );
  });
  // Arrow keys move between tabs, and choosing one is showing it, as the app's other tabs do.
  const moveTab = (event: KeyboardEvent) => {
    const index = pins.findIndex((pin) => pinId(pin) === shown.id);
    const last = pins.length - 1;
    const steps: Record<string, number> = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index <= 0 ? last : index - 1, Home: 0, End: last };
    const next = steps[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const id = pinId(pins[next]!);
    setChosen(id);
    document.getElementById(tabId(id))?.focus();
  };
  return (
    <>
      {status}
      <section key="bar" ref={bar} class="tf-pinbar" aria-label="Pinned" hidden={hidden} data-open={open ? 'true' : undefined} onKeyDown={onKeyDown}>
        {/* A pin on Settings, where the bar does not show, neither polls nor counts down. */}
        <ScreenActive.Provider value={!hidden}>{many ? <div role="tabpanel" id={VIEW} aria-labelledby={shown.id ? tabId(shown.id) : undefined}>{feeds}</div> : feeds}</ScreenActive.Provider>
        {stale && (
          <div class="tf-pinbar__stale">
            <Warnline tone="caution">{stale}</Warnline>
          </div>
        )}
        {many && (
          <div class="tf-pinbar__tabs" role="tablist" aria-label="Pins" onKeyDown={moveTab}>
            {pins.map((pin) => {
              const id = pinId(pin);
              const selected = id === shown.id;
              return (
                <button key={id} type="button" role="tab" class="tf-pinbar__tab" id={tabId(id)} aria-selected={selected} aria-controls={VIEW} tabIndex={selected ? 0 : -1} onClick={() => setChosen(id)}>
                  <span class="tf-sr">{pin.arrival ? 'Pinned arrival, ' : 'Pinned trip, '}</span>
                  <span class="tf-pinbar__tabname">{pinName(pin, saved.find((item) => item.id === id)?.name)}</span> <b>{reports[id]?.tab}</b>
                </button>
              );
            })}
          </div>
        )}
        {open && <div class="tf-pinbar__scrim" aria-hidden="true" onClick={close} />}
      </section>
      <Toast key="toast" message={toast} page above={above} quiet onDone={clear} />
    </>
  );
}

// Where the bar sits, told to the app shell (see PinBar.css), which starts its sheets and the
// screen kept under another below the bar. The bar stays put while it takes a quarter of the
// screen's height or less. Taller, as with large text or on a short screen, it scrolls away with
// the page (J, 2026-11-09): it lies over the top of the page, which leaves it room, and moves up
// as the page scrolls.
function useBarPlace(bar: { current: HTMLElement | null }, present: boolean, page: Page) {
  useLayoutEffect(() => {
    const element = bar.current;
    const app = element?.parentElement;
    if (!element || !app || !present) return;
    let height = 0;
    let scrolls = false;
    const place = () => {
      const scrolled = scrolls ? (app.querySelector<HTMLElement>(':scope > .tf-layer > .tf-scroll')?.scrollTop ?? 0) : 0;
      const away = Math.min(scrolled, height);
      app.style.setProperty('--pinbar-away', `${away}px`);
      app.style.setProperty('--pinbar-shown', `${height - away}px`);
    };
    const measure = () => {
      height = element.offsetHeight;
      scrolls = height > innerHeight / 4;
      app.style.setProperty('--pinbar-h', `${height}px`);
      app.dataset.pinbar = scrolls ? 'scrolls' : 'stuck';
      place();
    };
    const onScroll = (event: Event) => {
      if (scrolls && event.target instanceof Element && event.target.matches('.tf-layer > .tf-scroll')) place();
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    measure();
    // A page come back to is scrolled where it was after this runs (see main.tsx).
    const frame = requestAnimationFrame(place);
    app.addEventListener('scroll', onScroll, { capture: true, passive: true });
    addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
      app.removeEventListener('scroll', onScroll, { capture: true });
      removeEventListener('resize', measure);
      for (const name of ['--pinbar-away', '--pinbar-shown', '--pinbar-h']) app.style.removeProperty(name);
      delete app.dataset.pinbar;
    };
  }, [present, page]);
}

// A pin by the name the rider gave its saved search, or else by its stops.
const pinName = ({ search }: StoredPin, saved: string | undefined) => saved ?? (search.to ? `${search.fromLabel} to ${search.toLabel}` : search.fromLabel);

type FeedProps = {
  pin: StoredPin;
  // The saved search's name, when it is saved.
  name: string | undefined;
  // The notices the rider dismissed, which alert counts leave out.
  dismissed: ReadonlySet<string>;
  // Whether the bar shows this pin, and its panel.
  shown: boolean;
  open: boolean;
  onReport: Report;
  onToggle: () => void;
  onClose: () => void;
};

// Tells the bar how the pin stands, and that it has gone once it unmounts. Before paint, so the
// tabs show in the same frame as the bar.
function useReport(onReport: Report, id: string, report: Omit<PinReport, 'id'> | null) {
  const key = JSON.stringify(report);
  useLayoutEffect(() => onReport(id, report && { id, ...report }), [id, key]);
  useLayoutEffect(() => () => onReport(id, null), [id]);
}

// A pin waiting for its first times.
const waitingNote = (offline: boolean) => (offline ? 'Times can’t load right now. They show again once the phone is back online.' : 'Getting live predictions…');

// A pinned trip, following its own request as its results do: the countdown to what happens next,
// the vehicle and time that matter at this point of the trip, and in the panel the steps left.
function TripFeed({ pin, name: savedName, dismissed, shown, open, onReport, onToggle, onClose }: FeedProps) {
  const { settings } = useSettings();
  const deviceNow = useNow();
  const { search } = pin;
  const id = pinId(pin);
  // On the tab it was pinned on, its answer stored as the search's own, which its results share.
  const polled = usePoll<TripResponse>(apiUrl.trip(search, settings, false, pin, pin.view), 30_000, null, apiUrl.trip(search, settings, false, null, pin.view));
  usePinRefresh(polled.refresh);
  const { data, feed, answered } = polled;
  const live = liveClock(polled, deviceNow);
  const now = live.now;
  const { pinned, unpinAt, expired } = usePinnedTrip(pin, data, answered, search, settings, now, (next) => setPin(search, next));
  const colorOf = useMemo(() => (data ? pageColors(summarize(search, data, data.generatedAt * 1000).groups, data) : undefined), [data]);
  const name = pinName(pin, savedName);
  const route = `${search.fromLabel} to ${search.destLabel ?? search.toLabel}`;
  const frame = {
    kind: 'trip' as const,
    name,
    sub: route === name ? null : route,
    href: pin.view ? resultsPath(search, pin.view) : tripPath(search),
    open,
    onToggle,
    onClose,
    onUnpin: () => changePin(search, null, data?.routes),
  };
  const stale = data ? liveNote(feed, live.fresh, polled.settled) : null;
  const second = pinned?.second;
  const known = data !== null && pinned !== null && Boolean(second?.on) && !(pinned.first !== undefined && !pinned.first?.on);
  const view = known ? tripView() : null;
  useReport(onReport, id, expired ? null : (view?.report ?? { at: null, ended: false, tab: '', step: null, says: '', stale }));
  if (expired || !shown) return null;
  if (!view) {
    const note = data ? 'Times for this trip are not available right now.' : waitingNote(feed === 'offline');
    return <BarView {...frame} spoken={`Pinned trip, ${name}. ${note}`} verb={null} num={null} unit={null} l2={[note]} />;
  }
  return <BarView {...frame} {...view.bar} />;

  function tripView() {
    const trip = { first: pinned!.first ?? null, second: second! };
    const { first } = trip;
    const leg2 = trip.second;
    const { routes, stops } = data!;
    const stopName = (stop: PinnedStop) => shortStopName(stops[stop.stop], stop.stop);
    const label = (leg: PinnedLeg) => (routes[leg.route] ? chipLabel(routes[leg.route]!) : 'Vehicle');
    const phase = pinnedPhase(pinned!, now / 1000);
    const transfer = pinnedTransfer(pinned!);
    // The pinned connection as the results have it, when they still do.
    const group = pin.first ? data!.groups.find(({ board }) => board === pin.second.board) : undefined;
    const connection = group?.departures.flatMap(({ connections }) => connections).find(({ trip }) => trip === pin.first!.trip);
    // The walk between the two vehicles, as the results give it: the row's own when its vehicle lets
    // the rider off at another stop than its group's.
    const walkMeters = pin.first ? (connection?.walkMeters ?? group?.walkMeters) : undefined;
    const walk = walkMeters !== undefined && walkMeters >= 15 ? `${walkMinutes(walkMeters, settings.walkSpeed)}\u00a0min walk to ${stopName(leg2.on!)}` : null;
    // The window's shortest transfer, which the map marks a tight transfer by, as results do. A
    // hidden connection is outside the window already.
    const min = group && !connection?.hidden ? group.window.min : undefined;
    const missed = transfer !== null && transfer < 0;
    // Each vehicle's Scheduled tag says it of the time it is boarded. Getting off, and the transfer
    // between them, say it themselves.
    const transferScheduled = Boolean(first?.off && (scheduledAt(first, first.off) || !leg2.live));
    const transferText = (minutes: number) => `${approx(String(minutes), transferScheduled)}\u00a0min`;
    const canceled = [first, leg2].find((leg) => leg?.canceled);
    const canceledText = canceled ? `The ${label(canceled)} at ${clock(canceled.on?.at ?? canceled.off!.at)} is canceled` : null;
    const countdown = tripCountdown(phase, first, leg2, now);
    const focus = pinFocus(phase, first, leg2);
    const status = statusAt(focus.stop.at, now, focus.stop.delay, focus.leg.live, focus.leg.canceled, focus.leg.notStarted);
    const verb = pinVerb(phase, { soon: countdown.num === 'Now', transfers: first !== null, vehicle: vehicleWord(routes[leg2.route]), reaches: Boolean(leg2.off) });
    const ahead = phase === 'wait' || phase === 'ride';
    const where = alertStops(phase, trip);
    const alertsAt = (at: string[]): Alert[] => stopAlerts(data!.alerts, new Set(at), dismissed);
    const alertCount = alertsAt([...where.boarding, ...where.changing]).length;
    const alertLines = (alerts: Alert[]) =>
      alerts.map((alert) => (
        <Warnline key={alert.id} tone="late">
          {titleAndBody(alert.header, alert.description).title}
        </Warnline>
      ));
    const statusText = tripStatusText(phase, first, leg2, stopName, label, now);
    const offScheduled = !focus.boards && phase !== 'done' && scheduledAt(focus.leg, focus.stop);
    const spoken = [
      `Pinned trip, ${name}.`,
      canceledText && `${canceledText}.`,
      phase === 'done' ? `${statusText}.` : `${statusText}, ${clock(focus.stop.at)}${focus.boards ? `, ${status.label.toLowerCase()}` : ''}.`,
      ahead && transfer !== null && (missed ? `Transfer to the ${label(leg2)} missed by ${minuteCount(-transfer)}${transferScheduled ? ', scheduled' : ''}.` : `${transferScheduled ? 'Scheduled ' : ''}${transfer} minute transfer to the ${label(leg2)}.`),
      alertCount > 0 && `${alertCount} alert${alertCount === 1 ? '' : 's'} where you board.`,
    ]
      .filter(Boolean)
      .join(' ');

    // The map's sheet can unpin the trip, and pin it again.
    const sheetPin: PinAction = { pinned: true, label: pinLabel(...(first ? [[routes[first.route], first.on!.at] as const] : []), [routes[leg2.route], leg2.on!.at]), set: (on) => changePin(search, on ? pin : null, routes, on && ringsBell(pin, data)) };
    const map = pinMap(phase, trip, {
      routes,
      ...(colorOf ? { colorOf } : {}),
      transfer: { ...(transfer !== null ? { minutes: transfer, scheduled: transferScheduled } : {}), ...(min !== undefined ? { min } : {}), ...(walkMeters !== undefined ? { walkMeters } : {}) },
    });
    const destination = pinnedDestination(pin, data!, search.dest);
    const total = tripMinutes(pinned!);
    const steps = restOfTrip(phase, trip).map((step) => {
      if (step === 'off') {
        return (
          <Step key={step} at={first!.off!.at} scheduled={scheduledAt(first!, first!.off!)}>
            <span class="tf-pinbar__step">
              <span>
                Get off at <b>{stopName(first!.off!)}</b>
              </span>
            </span>
            {walk && <span class="tf-l2">{walk}</span>}
          </Step>
        );
      }
      if (step === 'board') {
        return (
          <Step key={step} at={leg2.on!.at} scheduled={false}>
            <span class="tf-pinbar__step">
              <span>
                Board <RouteChip route={routes[leg2.route]} {...(colorOf ? { color: colorOf(leg2.route) } : {})} />{' '}
                {transfer !== null && (missed ? <b class="tf-pinbar__missed tf-nowrap">Missed by {transferText(-transfer)}</b> : <b class="tf-nowrap">{transferText(transfer)} transfer</b>)}
              </span>
            </span>
            {/* The walk there, a step up, names the stop already. */}
            <Dots class="tf-l2" parts={[<StatusTag status={statusAt(leg2.on!.at, now, leg2.on!.delay, leg2.live, leg2.canceled, leg2.notStarted)} plain />, !walk && `at ${stopName(leg2.on!)}`]} />
            {alertLines(alertsAt(where.changing))}
          </Step>
        );
      }
      return (
        <Step key={step} at={leg2.off!.at} scheduled={scheduledAt(leg2, leg2.off!)}>
          <span class="tf-pinbar__step">
            <span>
              {phase === 'done' ? 'Arrived at' : 'Arrive'} <b>{stopName(leg2.off!)}</b>
            </span>
          </span>
          {total && <span class="tf-l2">{tripMinutesText(total)}</span>}
        </Step>
      );
    });
    return {
      report: { at: countdown.at, ended: phase === 'done', tab: countdown.unit ? `${countdown.num}\u00a0${countdown.unit}` : phase === 'done' ? 'Done' : countdown.num, step: `${phase}${canceled ? ' canceled' : ''}`, says: `${name}. ${canceledText ?? statusText}.`, stale },
      bar: {
        spoken,
        verb,
        num: countdown.num,
        unit: countdown.unit,
        l1: (
          <>
            <RouteChip route={routes[focus.leg.route]} {...(colorOf ? { color: colorOf(focus.leg.route) } : {})} />
            <span>{approx(clock(focus.stop.at), offScheduled)}</span>
          </>
        ),
        l2: [
          focus.boards ? <StatusTag status={status} plain /> : phase === 'done' && !leg2.off ? `Left ${stopName(focus.stop)}` : phase === 'done' ? `Reached ${stopName(focus.stop)}` : `at ${stopName(focus.stop)}`,
          phase === 'change' && `at ${stopName(focus.stop)}`,
          canceled && !(focus.boards && canceled === focus.leg) && <span class="tf-tight">{label(canceled)} canceled</span>,
          alertCount > 0 && <AlertCount count={alertCount} />,
        ],
        end:
          ahead && transfer !== null ? (
            <span class="tf-end">
              <span class={`tf-end__n${missed ? ' tf-pinbar__missed' : ''}`}>{missed ? 'Missed' : transferText(transfer)}</span>
              <span class="tf-end__u">{missed ? `by ${transferText(-transfer)}` : 'transfer'}</span>
            </span>
          ) : undefined,
        map: { ...map, pin: sheetPin, stops },
        panel: (
          <>
            {canceledText && (
              <p class="tf-pinbar__note">
                <span class="tf-tight">Canceled</span> {canceledText}.
              </p>
            )}
            {alertLines(alertsAt(where.boarding))}
            {steps.length > 0 && (
              <div class="tf-pinbar__steps" role="list" aria-label="Rest of the trip">
                {steps}
              </div>
            )}
            {destination && !leg2.off && (
              <p class="tf-pinbar__note">
                This {label(leg2)} does not stop at {shortStopName(stops[destination], 'your destination')}.
              </p>
            )}
            {phase === 'done' && unpinAt !== null && <p class="tf-pinbar__note">Unpins at {clock(unpinAt / 1000)}</p>}
          </>
        ),
      },
    };
  }
}

// An arrival pinned at a stop, following the stop's times: the countdown to its vehicle coming, its
// live time and status, and where it is going. Until the stop's times arrive, or once the vehicle
// has gone by, it says so with what the pin kept.
function StopFeed({ pin, name: savedName, dismissed, shown, open, onReport, onToggle, onClose }: FeedProps) {
  const { settings } = useSettings();
  const deviceNow = useNow();
  const { search } = pin;
  const id = pinId(pin);
  // Asked with the pin, its answer stored as the stop's, which its page and its saved card share.
  const polled = usePoll<StopResponse>(apiUrl.stop(search.from, settings, pin), 30_000, null, apiUrl.stop(search.from, settings));
  usePinRefresh(polled.refresh);
  const { data, feed, answered } = polled;
  const live = liveClock(polled, deviceNow);
  const now = live.now;
  const { found, unpinAt, expired } = useStopPin(pin, data, answered, search, settings, now, (next) => setPin(search, next));
  const { arrival, canceled, lost } = found ?? pinnedArrival(pin, data);
  const route = data?.routes[arrival?.route ?? pin.arrival?.route ?? ''];
  const at = arrival?.at ?? pin.ends;
  const minutes = minutesUntil(at, now);
  const gone = !canceled && data !== null && hasLeft(at, now, arrival?.notStarted);
  const stop = data?.stops[pin.second.board];
  const vehicle = vehicleAt(route, at);
  const status = arrival && !canceled ? statusAt(at, now, arrival.delay, arrival.live, false, arrival.notStarted) : null;
  const notStarted = stillWaiting(at, now, arrival?.notStarted) && !canceled;
  const countdown = arrivalCountdown(at, now, { canceled, known: data !== null, notStarted });
  const note = !data ? waitingNote(feed === 'offline') : lost ? 'Times for this arrival are not available right now.' : null;
  const name = pinName(pin, savedName);
  const stopName = shortStopName(stop, search.fromLabel);
  const headsign = pin.arrival?.headsign;
  const stale = data ? liveNote(feed, live.fresh, polled.settled) : null;
  const toward = `The ${route ? chipLabel(route) : 'vehicle'}${headsign ? ` toward ${headsign}` : ''}`;
  const says = canceled ? `The ${vehicle} is canceled.` : gone ? `The ${vehicle} has come.` : `${toward}, ${notStarted ? `in at least ${minuteCount(Math.max(1, minutes))}` : countdown.unit ? `in ${minuteCount(minutes)}` : 'arriving now'}, ${clock(at)}${status ? `, ${status.label.toLowerCase()}` : ''}.`;
  const ended = gone || (canceled && at * 1000 < now);
  useReport(
    onReport,
    id,
    expired ? null : note ? { at: null, ended: false, tab: '', step: null, says: '', stale } : { at, ended, tab: canceled ? 'Canceled' : gone ? 'Arrived' : countdown.unit ? `${countdown.num}\u00a0${countdown.unit}` : countdown.num, step: canceled ? 'canceled' : gone ? 'gone' : 'coming', says: `${name}. ${says}`, stale },
  );
  if (expired || !shown) return null;
  const frame = {
    kind: 'arrival' as const,
    name,
    sub: stopName === name ? null : stopName,
    href: stopPath(search),
    open,
    onToggle,
    onClose,
    onUnpin: () => changePin(search, null, data?.routes),
  };
  if (note) return <BarView {...frame} spoken={`Pinned arrival at ${name}. ${note}`} verb={null} num={null} unit={null} l2={[note]} />;
  const sheetPin: PinAction = { pinned: true, label: pinLabel([route, at]), set: (on) => changePin(search, on ? pin : null, data?.routes, on && ringsBell(pin, data)) };
  // Alerts about its stop or its route, counted and said as a pinned trip's are. Not once it has
  // gone or is canceled, when they no longer matter to the rider.
  const alerts = data && !ended && !canceled ? arrivalAlerts(data.alerts, arrival?.route ?? pin.arrival?.route, pin.second.board, dismissed) : [];
  const alertCount = alerts.length;
  const alertsWhere = alerts.every(({ relevance }) => relevance === 'stop') ? 'where you board' : 'on its route or where you board';
  return (
    <BarView
      {...frame}
      spoken={`Pinned arrival at ${name}. ${says}${alertCount > 0 ? ` ${alertCount} alert${alertCount === 1 ? '' : 's'} ${alertsWhere}.` : ''}`}
      verb={canceled ? 'canceled' : gone ? 'arrived' : countdown.unit ? 'arrives in' : 'arriving'}
      num={countdown.num}
      unit={countdown.unit}
      l1={
        <>
          <RouteChip route={route} />
          <span>{clock(at)}</span>
        </>
      }
      l2={[canceled ? <span class="tf-tight">Canceled</span> : status && <StatusTag status={status} plain />, headsign && `→ ${headsign}`, alertCount > 0 && <AlertCount count={alertCount} />]}
      map={data ? { trip: pin.second.trip, stop: pin.second.board, title: vehicle, marks: [{ stop: pin.second.board, kind: 'yours' }], pin: sheetPin, stops: data.stops } : undefined}
      panel={
        <>
          {alerts.map((alert) => (
            <Warnline key={alert.id} tone="late">
              {titleAndBody(alert.header, alert.description).title}
            </Warnline>
          ))}
          {ended && unpinAt !== null && <p class="tf-pinbar__note">Unpins at {clock(unpinAt / 1000)}</p>}
        </>
      }
    />
  );
}

// How many alerts a pin has, in the bar's status line. Kept whole on one line.
const AlertCount = ({ count }: { count: number }) => (
  <span class="tf-pinbar__alerts">
    <IconWarn size={14} /> {count} alert{count === 1 ? '' : 's'}
  </span>
);

// One step of the trip in the open panel: its time where a row has its number, then what to do.
// What to do is one run of text inside its .tf-pinbar__step, which centers a single line on the time.
function Step({ at, scheduled, children }: { at: number; scheduled: boolean; children: ComponentChildren }) {
  return (
    <div class="tf-row" role="listitem">
      <span class="tf-num">
        <span class="tf-num__clock">
          <Approx scheduled={scheduled}>{clock(at)}</Approx>
        </span>
      </span>
      <span class="tf-rb">
        <span class="tf-rb__main">{children}</span>
      </span>
    </div>
  );
}

// What every pin's bar shares. The bar is one button, a disclosure named with all it shows, so
// what it shows is hidden from screen readers. One small line names it, "Pinned · To Mom's ·
// leaves in", whose last words follow the moment (see pinVerb), then the row. Its panel, shown once
// open, has the pin's name, what the feed has to add, and the three actions. It stays in the page
// while shut, so the bar's map link keeps an open map's sheet told of the pin (see TimeLink).
function BarView({ kind, name, sub, href, open, onToggle, onClose, onUnpin, spoken, verb, num, unit, l1, l2, end, map, panel }: {
  kind: 'trip' | 'arrival';
  name: string;
  // What the name leaves unsaid: the trip's ends, or the stop.
  sub: string | null;
  // The pin's own page, on the tab it was pinned on.
  href: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onUnpin: () => void;
  spoken: string;
  verb: string | null;
  num: string | null;
  unit: string | null;
  l1?: ComponentChildren;
  // The parts of the status line, a dot between them.
  l2: ComponentChildren[];
  end?: ComponentChildren;
  map?: (PinMap & { pin: PinAction; stops: TripResponse['stops'] }) | undefined;
  panel?: ComponentChildren;
}) {
  const { stops, stop, ...track } = map ?? {};
  const watched = stop ? stops?.[stop] : undefined;
  return (
    <>
      <button type="button" class="tf-pinbar__main" aria-expanded={open} aria-controls={PANEL} aria-label={spoken} onClick={onToggle}>
        <span class="tf-pinbar__in">
          <Dots class="tf-pinbar__naming" parts={[<b>Pinned</b>, <span class="tf-pinbar__named">{name}</span>, verb]} />
          <span class="tf-pinbar__line">
            <span class="tf-row">
              <Num n={num} unit={unit} />
              <span class="tf-rb">
                <span class="tf-rb__main">
                  {l1 && <span class="tf-l1">{l1}</span>}
                  <Dots class="tf-l2" parts={l2} />
                </span>
                {end}
              </span>
            </span>
            <span class="tf-pinbar__chev">
              <IconChevron />
            </span>
          </span>
        </span>
      </button>
      <div class="tf-pinbar__panel" id={PANEL} role="group" aria-label={`${name}, pinned ${kind}`} tabIndex={-1} hidden={!open}>
        <div class="tf-pinbar__in">
          <p class="tf-pinbar__name">
            <b>{name}</b>
            <Dots class="tf-muted" parts={[`Pinned ${kind}`, sub]} />
          </p>
          {panel}
          {/* Any of the three shuts the panel, and focus goes back to the bar, which a map's sheet
              then returns it to. */}
          <div class="tf-pinbar__actions" onClick={onClose}>
            <AppLink class="tf-pinbar__action" href={href}>
              Open {kind === 'trip' ? 'trip' : 'stop'}
              <span class="tf-sr">, {name}</span>
            </AppLink>
            {map && watched && (
              <TimeLink {...(track as Omit<PinMap, 'stop'> & { pin: PinAction })} stop={watched}>
                <IconFullRoute />
                Live map
              </TimeLink>
            )}
            <button type="button" class="tf-pinbar__action" onClick={onUnpin}>
              <IconClose size={16} />
              Unpin<span class="tf-sr"> {name}</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
