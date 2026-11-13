import { type ComponentChildren, createContext } from 'preact';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { SLIDE_MS, motionOff, useDrag } from '../gestures.ts';
import { focusInstead } from '../focus.ts';
import { AppSheets } from '../layers.ts';
import { cameBackTo, closeSheetEntry, currentKey, currentUnder, isSheetEntry, openSheetEntry } from '../router.ts';
import { IconClose } from '../icons/ui.tsx';
import { Chain } from './Whole.tsx';

// A drag down closes the sheet past this share of its height, or this far, whichever is less.
const CLOSE_SHARE = 1 / 3;
const CLOSE_PX = 140;
// Or when flung down at least this fast, in px per ms.
const CLOSE_FLING = 0.4;

// Leaves the sheet a control is in open as it is, and does `then`, such as putting another page in
// the one under it, which rises over both (see main.tsx). Outside a sheet, it does `then`.
const LeaveOpen = createContext<(then: () => void) => void>((then) => then());
export const useLeaveOpen = () => useContext(LeaveOpen);

// Bottom sheet: focus moves in on open, Escape and the scrim close it, and focus returns to the
// button that opened it. It is a dialog but not a modal one: the page behind it is inert, and the
// app's pin bar, which stays in view above it, is not, so Tab reaches the bar and then the sheet,
// with a keyboard and a screen reader alike. Dragging down closes it too. Its top, the
// handle and title, stays put while the settings under it scroll, and a drag down from there
// closes the sheet however far it is scrolled, like the comments on YouTube Shorts. In the
// settings, a drag down closes it only from the top of their scroll, so scrolling back up never
// closes it by surprise. It is a step in history of its own, so the system back closes it rather
// than leaving the page under it, and closing it any other way takes that step back.
// `action` is a control beside Close, such as pinning the trip a map follows.
// What the rider last pressed, until a key is. WebKit does not focus a button or link it is tapped
// or clicked: focus stays where it was, or goes to an ancestor that can take it, such as the page's
// main once it has a tabindex (see focusInstead). So the button pressed inside what has focus is
// what opened a sheet, for focus to go back to once it closes. Read once.
let pressed: HTMLElement | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', (event) => (pressed = (event.target as Element | null)?.closest<HTMLElement>('button, a[href]') ?? null), true);
  document.addEventListener('keydown', () => (pressed = null), true);
}
const opener = () => {
  const active = document.activeElement as HTMLElement | null;
  const tapped = pressed?.isConnected ? pressed : null;
  pressed = null;
  if (tapped && (!active || active === document.body || active.contains(tapped))) return tapped;
  return active && active !== document.body ? active : null;
};

// Everything in `parent` but the sheet turns inert, apart from the screen's toast region, which shows
// above the sheet so a toast raised from the sheet, such as Saved with its Undo, can be tapped.
// Only what is around the region turns inert. Returns what it made inert.
function inertBehind(parent: Element, sheet: Element) {
  const made: HTMLElement[] = [];
  const around = (container: Element) => {
    for (const element of [...container.children] as HTMLElement[]) {
      if (element === sheet || element.classList.contains('tf-sheet') || element.classList.contains('tf-toast-region') || element.inert) continue;
      if (element.querySelector('.tf-toast-region')) around(element);
      else {
        element.inert = true;
        made.push(element);
      }
    }
  };
  around(parent);
  return made;
}

export function Sheet({ title, subtitle, footer, action, onClose, children }: {
  title: string;
  subtitle?: string;
  footer?: ComponentChildren;
  action?: ComponentChildren;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const step = useRef('');
  const app = useContext(AppSheets);
  // What had focus as the sheet opened (see opener), read once, at the first render, before the
  // page behind turns inert, which takes focus off whatever in it had it.
  const [openedFrom] = useState(() => ({ current: opener() }));
  // The page behind is inert while the sheet is open. Over the whole app, the app makes its pages
  // so (see main.tsx). Inside a screen, that is everything else in the screen, which nothing else
  // makes inert. The pin bar is outside both.
  useLayoutEffect(() => {
    const sheet = root.current;
    const parent = sheet?.parentElement;
    if (!sheet || !parent) return;
    if (parent.classList.contains('tf-app')) return app.hold();
    const behind = inertBehind(parent, sheet);
    return () => {
      for (const element of behind) element.inert = false;
    };
  }, []);
  // Opened again on the rider's way back to the page, it is scrolled where they left it. Read at
  // once, before the page clears what it left behind (see Left in router.ts).
  const returning = useRef(cameBackTo());
  useLayoutEffect(() => {
    const back = returning.current;
    if (back?.sheet === title && back.sheetScroll && body.current) body.current.scrollTop = back.sheetScroll;
  }, []);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  // However it closes, the sheet slides away first, once (J, 2026-10-08). A drag lets go of it
  // where the finger left it, and Close, Done, the scrim, Escape, and the system back from where it
  // stands.
  const sliding = useRef(false);
  // Left open for a page coming up over it, it is gone with its page.
  const kept = useRef(false);
  const slid = useRef<(then?: () => void) => void>(() => {});
  useEffect(() => {
    step.current = openSheetEntry(title);
    const pageKey = currentUnder();
    // Covered by a page a link in the sheet opened, it stays open with its page kept under that
    // one (see main.tsx), and takes a step back of its own again once the rider is back.
    let covered = false;
    const onPop = () => {
      if (isSheetEntry(step.current) || kept.current) return;
      if (currentKey() !== pageKey) return void (covered = true);
      if (!covered) return sliding.current ? latestClose.current() : slid.current(() => latestClose.current());
      covered = false;
      closeSheetEntry(step.current);
      step.current = openSheetEntry(title);
    };
    addEventListener('popstate', onPop);
    return () => {
      removeEventListener('popstate', onPop);
      closeSheetEntry(step.current);
    };
  }, []);
  // Its step back closes it, by way of the listener above. A page that replaced the step, such as
  // one a link in the sheet opened, leaves nothing to take back.
  const close = () => (isSheetEntry(step.current) ? history.back() : onClose());
  const slideAway = (then?: () => void) => {
    if (sliding.current) return;
    sliding.current = true;
    place(panel.current?.offsetHeight ?? 0, true);
    setTimeout(then ?? close, motionOff() ? 0 : SLIDE_MS);
  };
  slid.current = slideAway;
  // Moves the panel down by offset px and fades the scrim to match. Styles are set directly, as
  // a render per touch event would lag behind the finger.
  const place = (offset: number, animated: boolean) => {
    const sheet = panel.current;
    const shade = scrim.current;
    if (!sheet || !shade) return;
    for (const element of [sheet, shade]) element.style.transition = animated ? '' : 'none';
    sheet.style.transform = offset > 0 ? `translateY(${offset}px)` : '';
    shade.style.opacity = offset > 0 ? String(Math.max(0, 1 - offset / sheet.offsetHeight)) : '';
  };
  useDrag(() => panel.current, 'y', {
    // A slider's thumb is the slider's to drag, and a sheet already sliding away is gone.
    claim: (direction, origin) =>
      !sliding.current && direction === 'down' && !origin.closest('input[type="range"]') && (origin.closest('.tf-sheet__top') !== null || (body.current?.scrollTop ?? 1) <= 0),
    move: (dy) => place(Math.max(0, dy), false),
    end: (release) => {
      const height = panel.current?.offsetHeight ?? 0;
      if (!release || (release.distance < Math.min(height * CLOSE_SHARE, CLOSE_PX) && release.velocity < CLOSE_FLING)) return place(0, true);
      slideAway();
    },
  });
  useEffect(() => {
    const opener = openedFrom.current;
    // Without scrolling: the panel starts below the screen as it rises, and focusing it there
    // would scroll the whole app up to bring it into view.
    requestAnimationFrame(() => panel.current?.focus({ preventScroll: true }));
    // Once the sheet is gone, focus goes back to what opened it. That may be gone or hidden by then,
    // such as a pin bar whose last pin was unpinned from the sheet, and then focus goes to the
    // page, unless something else took it in the meantime.
    return () =>
      requestAnimationFrame(() => {
        if (opener?.isConnected) opener.focus();
        if (document.activeElement !== opener && (!document.activeElement || document.activeElement === document.body)) focusInstead(null);
      });
  }, []);
  // Escape closes it from wherever focus is, the pin bar included, unless something nearer took
  // the key, as the bar's open panel does. Only the sheet on top, in a page that is showing.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const open = [...document.querySelectorAll('.tf-sheet')].filter((sheet) => !sheet.closest('[inert]'));
      if (open.at(-1) !== root.current) return;
      event.preventDefault();
      slid.current();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
  return (
    <div ref={root} class={`tf-sheet${returning.current?.sheet === title ? ' tf-sheet--returning' : ''}`} inert={app.covered}>
      <div ref={scrim} class="tf-sheet__scrim" aria-hidden="true" onClick={() => slideAway()} />
      <div ref={panel} class="tf-sheet__panel" role="dialog" aria-label={title} tabIndex={-1}>
        <div class="tf-sheet__top">
          <div class="tf-grabber" aria-hidden="true" />
          <div class="tf-sheet__inner">
            <div class="tf-sheet__head">
              <h2>{title}</h2>
              {action}
              <button type="button" class="tf-btn-icon" onClick={() => slideAway()} aria-label="Close">
                <IconClose />
              </button>
            </div>
            {subtitle && (
              <div class="tf-sheet__subtitle">
                <Chain text={subtitle} />
              </div>
            )}
          </div>
        </div>
        <div ref={body} class="tf-sheet__body">
          <div class="tf-sheet__inner">
            <LeaveOpen.Provider value={(then) => ((kept.current = true), then())}>{children}</LeaveOpen.Provider>
            {footer && <div class="tf-sheet__saved">{footer}</div>}
            <button type="button" class="tf-btn-primary tf-sheet__done" onClick={() => slideAway()}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// A row of toggle chips. Each says its state through aria-pressed.
export function Toggle({ pressed, swatch, onToggle, children }: { pressed: boolean; swatch?: string; onToggle: () => void; children: ComponentChildren }) {
  return (
    <button type="button" class="tf-filter" aria-pressed={pressed} onClick={onToggle}>
      {swatch && <span class="tf-filter__swatch" style={{ background: swatch }} />}
      {children}
    </button>
  );
}

// One of a few options, the chosen one filled like the results page's switchers. Unlike a
// switcher the options wrap, for long labels or many choices.
export function Choices<K extends string | number>({ label, options, selected, onChoose }: { label: string; options: { key: K; text: ComponentChildren }[]; selected: K; onChoose: (key: K) => void }) {
  return (
    <div class="tf-filters" role="group" aria-label={label}>
      {options.map(({ key, text }) => (
        <button key={key} type="button" class="tf-filter tf-choice" aria-pressed={selected === key} onClick={() => onChoose(key)}>
          {text}
        </button>
      ))}
    </div>
  );
}
