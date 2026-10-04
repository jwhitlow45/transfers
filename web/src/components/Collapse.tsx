import type { ComponentChildren } from 'preact';

// Content that opens and closes by sliding its height. It stays in the page while closed, so
// closing can animate as well as opening, and is inert then: nothing in it can be focused or
// read by a screen reader. The animation follows the motion setting like every other.
export function Collapse({ open, id, children }: { open: boolean; id?: string; children: ComponentChildren }) {
  return (
    <div id={id} class={`tf-collapse${open ? ' tf-collapse--open' : ''}`} inert={!open}>
      <div class="tf-collapse__inner">{children}</div>
    </div>
  );
}
