import { type ComponentChildren, Fragment } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { chainSteps, nameGroups } from '../lib/wrap.ts';

const FITS = 'tf-whole--fits';

// The block whose width is the line an inline element sits on.
function lineOf(element: HTMLElement) {
  let line = element.parentElement;
  while (line && ['inline', 'contents'].includes(getComputedStyle(line).display)) line = line.parentElement;
  return line;
}

// One wrapping rule for everything built of parts and names (J's audit, 2026-11-10): a part that
// fits on a line never splits, and one longer than a line wraps inside itself, with what follows
// it going on after its last word. CSS alone cannot do both, as a box kept whole takes the rest
// of its last line. So a part wraps as any text does (.tf-whole) until it is measured to fit its
// line, and is then kept on one (.tf-whole--fits). Wrapping is what it does unmeasured, so a part
// can never widen what holds it. Measured before paint, when its text changes, and when the
// window's width does.
function useWhole() {
  const ref = useRef<HTMLSpanElement>(null);
  // The width the text needs on one line, kept while the text stays the same, so a part is not
  // laid out both ways at every render.
  const natural = useRef<{ text: string; width: number } | null>(null);
  const line = useRef<HTMLElement | null>(null);
  const fit = () => {
    const element = ref.current;
    if (!element) return;
    line.current ??= lineOf(element);
    if (!line.current) return;
    const text = element.textContent ?? '';
    const changed = natural.current?.text !== text;
    // Wrapping again first, so the line is as wide as it is without this part's help.
    if (changed) element.classList.remove(FITS);
    const style = getComputedStyle(line.current);
    const room = line.current.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    // Not laid out, as in a section that is shut: left to wrap until it shows.
    if (room <= 0) return void (natural.current = null);
    if (changed) {
      element.classList.add(FITS);
      natural.current = { text, width: element.getBoundingClientRect().width };
    }
    element.classList.toggle(FITS, natural.current!.width <= room + 0.5);
  };
  useLayoutEffect(fit);
  useEffect(() => {
    const refit = () => {
      natural.current = null;
      fit();
    };
    addEventListener('resize', refit);
    return () => removeEventListener('resize', refit);
  }, []);
  return ref;
}

// Anything kept on one line while it fits one: a part of a dotted line, a step of a chain, a
// phrase such as "off 11:57 PM".
export function Whole({ class: name, children }: { class?: string; children: ComponentChildren }) {
  const ref = useWhole();
  return (
    <span ref={ref} class={`tf-whole${name ? ` ${name}` : ''}`}>
      {children}
    </span>
  );
}

// Words in the groups a line may break between (see nameGroups), each kept whole while it fits.
export const Groups = ({ text }: { text: string }) => (
  <>
    {nameGroups(text).map((group, index) => (
      <Fragment key={index}>
        {index > 0 && ' '}
        <span class="tf-keep">{group}</span>
      </Fragment>
    ))}
  </>
);

// A stop's name, a headsign, or a name the rider gave: whole while it fits a line. Wider than
// one, it wraps with its last two words together and no line starting with "&" or "+".
export const Name = ({ text }: { text: string }) => (
  <Whole class="tf-name">
    <Groups text={text} />
  </Whole>
);

// "→ Airport": where something heads, the arrow joined to the name's first word, so it never
// ends a line, and a long name's later lines starting under that word, not under the arrow (see
// .tf-to). `spoken` is what a screen reader hears for the arrow, such as "toward ".
export const Toward = ({ text, spoken }: { text: string; spoken?: string }) => (
  <span class="tf-to">
    <Whole class="tf-name">
      <span class="tf-to__arrow" aria-hidden="true">
        →
      </span>
      {spoken && <span class="tf-sr">{spoken}</span>}
      {/* A word joiner: no line breaks between the arrow and the word after it. */}
      {'\u2060'}
      <Groups text={text} />
    </Whole>
  </span>
);

// A chain written with arrows, "Montgomery St → Daly City → 120": each step a name, and each
// arrow with the step after it.
export const Chain = ({ text }: { text: string }) => (
  <>
    {chainSteps(text).map((step, index) => (
      <Fragment key={index}>
        {index > 0 && ' '}
        <Name text={step} />
      </Fragment>
    ))}
  </>
);
