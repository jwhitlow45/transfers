import type { ComponentChildren, RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';

// Fewer letters than this before the ellipsis no longer say which name it is (see data-short).
const FEWEST = 8;

// How often each line was fitted: once for all its names, however many of them ask in one pass.
let pass = 0;
const fitted = new WeakMap<Element, number>();

// Fits every name on one line together. Each is laid out whole first, so the line shares its
// room between them as it would uncut, and then each is cut to the room it got. Cut one at a
// time, a name would take the room another had left, and squeeze that one's box onto its text.
function fitLine(line: Element, again = false) {
  if (!again && fitted.get(line) === pass) return;
  fitted.set(line, pass);
  // The next pass starts once this one's layout work is done.
  queueMicrotask(() => pass++);
  const cuts = [...line.querySelectorAll<HTMLElement>('.tf-cut')].flatMap((box) => {
    const shown = box.firstElementChild;
    const node = shown?.firstChild;
    return shown && node instanceof Text ? [{ box, shown, node, text: box.dataset.text ?? '' }] : [];
  });
  for (const { node, text } of cuts) node.data = text;
  const rooms = cuts.map(({ box }) => {
    const style = getComputedStyle(box);
    // The box's room for text is less its padding, which a box of italic text makes wide enough
    // for the lean of its last letter (see .tf-chain__derived).
    return box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) + 0.5;
  });
  cuts.forEach(({ box, shown, node, text }, index) => {
    const fits = () => shown.getBoundingClientRect().width <= rooms[index]!;
    delete box.dataset.short;
    if (fits()) return;
    let low = 0;
    let high = text.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      node.data = `${text.slice(0, middle).trimEnd()}…`;
      if (fits()) low = middle;
      else high = middle - 1;
    }
    const kept = text.slice(0, low).trimEnd();
    node.data = `${kept}…`;
    if (kept.length < FEWEST) box.dataset.short = 'true';
  });
}

// A name kept to one line and cut short where it does not fit. CSS's own ellipsis can follow a
// space ("City …") and leaves the box as wide as its room, so what comes next sits farther off
// than after a whole name. Here the ellipsis follows the last letter that fits, and the box is
// as wide as what it shows. Screen readers get the whole name. The box is `.tf-cut`, which lays
// it out as a block that may shrink (see styles.css). `after` goes in the box after the name.
// `within` names the line its names share (a CSS selector for an ancestor), which is its parent
// without one. A name cut to fewer than eight letters says so (data-short), for a line that can
// then give it more room.
export function Cut({ text, class: name, title, after, box, within }: { text: string; class?: string; title?: string; after?: ComponentChildren; box?: RefObject<HTMLSpanElement | null>; within?: string }) {
  const own = useRef<HTMLSpanElement>(null);
  const outer = box ?? own;
  const line = () => (within ? outer.current?.closest(within) : null) ?? outer.current?.parentElement ?? null;
  // Before paint on every render, as the text beside it may have changed, and again when the
  // room around it does.
  useLayoutEffect(() => {
    const around = line();
    if (around) fitLine(around);
  });
  useEffect(() => {
    const around = line();
    if (!around || typeof ResizeObserver === 'undefined') return;
    let width = around.clientWidth;
    const observer = new ResizeObserver(() => {
      if (around.clientWidth === width) return;
      width = around.clientWidth;
      fitLine(around, true);
    });
    observer.observe(around);
    return () => observer.disconnect();
  }, [within]);
  return (
    <span class={`tf-cut${name ? ` ${name}` : ''}`} title={title} ref={outer} data-text={text}>
      <span aria-hidden="true">{text}</span>
      <span class="tf-sr">{text}</span>
      {after}
    </span>
  );
}
