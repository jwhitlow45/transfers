import type { ComponentChildren } from 'preact';
import { IconWarn } from '../icons/ui.tsx';
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

// A short warning on a tint of its tone, such as a saved trip's alerts or a pinned card's old
// times. `class` places it.
export function Flag({ tone, class: className, children }: { tone: 'late' | 'caution'; class: string; children: ComponentChildren }) {
  return (
    <span class={`tf-flag tf-flag--${tone} ${className}`}>
      <IconWarn size={14} />
      {children}
    </span>
  );
}
