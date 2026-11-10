import type { ComponentChildren } from 'preact';
import { IconPin, IconWarn } from '../icons/ui.tsx';
import type { Status } from '../view.ts';

// Lateness tag. Every arrival shows one, and it is never hidden to save space. `hidden` keeps it
// from screen readers where a row's spoken summary already says it.
export function StatusTag({ status, plain = false, hidden = false }: { status: Status; plain?: boolean; hidden?: boolean }) {
  return (
    <span class={plain ? `tf-status-text tf-status-text--${status.kind}` : `tf-status tf-status--${status.kind}`} aria-hidden={hidden || undefined}>
      {status.label}
    </span>
  );
}

// The mark `approx` gives a value from the schedule alone, for text a screen reader reads as
// shown, which then hears "scheduled" in place of the "~".
export function Approx({ scheduled, children }: { scheduled: boolean; children: ComponentChildren }) {
  if (!scheduled) return <>{children}</>;
  return (
    <>
      <span aria-hidden="true">~</span>
      <span class="tf-sr">scheduled </span>
      {children}
    </>
  );
}

// The "+" `atLeast` gives a vehicle yet to leave the first stop of its trip, for text a screen
// reader reads as shown, which then hears "or more" after the minutes.
export const Plus = () => (
  <>
    <span aria-hidden="true">+</span>
    <span class="tf-sr"> or more</span>
  </>
);

// What a pinned row or card says under its status, in words, so the tint is never the only sign.
export const PinnedTag = () => (
  <span class="tf-tag-pinned">
    <IconPin filled size={14} />
    Pinned
  </span>
);

// A line of warning under a card's rows, such as a saved trip's alerts or times no longer live: an
// icon and words in the tone's color, with no fill of its own.
export function Warnline({ tone, children }: { tone: 'late' | 'caution'; children: ComponentChildren }) {
  return (
    <p class={`tf-warnline tf-warnline--${tone}`}>
      <IconWarn size={16} />
      <span>{children}</span>
    </p>
  );
}

// A short warning on a tint of its tone, such as a pinned card's old
// times. `class` places it.
export function Flag({ tone, class: className, children }: { tone: 'late' | 'caution'; class: string; children: ComponentChildren }) {
  return (
    <span class={`tf-flag tf-flag--${tone} ${className}`}>
      <IconWarn size={14} />
      {children}
    </span>
  );
}
