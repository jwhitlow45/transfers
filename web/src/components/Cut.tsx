import type { ComponentChildren, RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';

// A name kept to one line and cut short where it does not fit. CSS's own ellipsis can follow a
// space ("City …") and leaves the box as wide as its room, so what comes next sits farther off
// than after a whole name. Here the ellipsis follows the last letter that fits, and the box is
// as wide as what it shows. Screen readers get the whole name. The box is `.tf-cut`, which lays
// it out as a block that may shrink (see styles.css). `after` goes in the box after the name.
export function Cut({ text, class: name, title, after, box }: { text: string; class?: string; title?: string; after?: ComponentChildren; box?: RefObject<HTMLSpanElement | null> }) {
  const own = useRef<HTMLSpanElement>(null);
  const outer = box ?? own;
  const shown = useRef<HTMLSpanElement>(null);
  // What the last fit was worked out for: the name, its box's room, and the text around it.
  const fitted = useRef('');
  const fit = () => {
    const element = outer.current;
    const node = shown.current?.firstChild;
    if (!element || !shown.current || !(node instanceof Text)) return;
    const around = element.parentElement;
    const state = `${text}|${around?.clientWidth}|${[...(around?.children ?? [])].map((child) => (child === element ? '' : child.textContent)).join('|')}`;
    if (state === fitted.current) return;
    fitted.current = state;
    // Laid out whole first: the box then shrinks to the room it has.
    node.data = text;
    const room = element.clientWidth + 0.5;
    const fits = () => shown.current!.getBoundingClientRect().width <= room;
    if (fits()) return;
    let low = 0;
    let high = text.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      node.data = `${text.slice(0, middle).trimEnd()}…`;
      if (fits()) low = middle;
      else high = middle - 1;
    }
    node.data = `${text.slice(0, low).trimEnd()}…`;
  };
  // Before paint on every render, as the text beside it may have changed, and again when the
  // room around it does.
  useLayoutEffect(fit);
  useEffect(() => {
    const around = outer.current?.parentElement;
    if (!around || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fit);
    observer.observe(around);
    return () => observer.disconnect();
  });
  return (
    <span class={`tf-cut${name ? ` ${name}` : ''}`} title={title} ref={outer}>
      <span ref={shown} aria-hidden="true">
        {text}
      </span>
      <span class="tf-sr">{text}</span>
      {after}
    </span>
  );
}
