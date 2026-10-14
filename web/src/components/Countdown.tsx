import type { ComponentChildren } from 'preact';

// The countdown column of a results row or a pinned card: what is next in small capitals, its
// minutes large, and their unit under them. Hidden from screen readers, as each card says all of
// it in its spoken summary.
export function Countdown({ lead, num, unit }: { lead: ComponentChildren; num: ComponentChildren; unit: string | null }) {
  // Three digits fill the column, so a scheduled "~125" steps down a size to stay inside it.
  const long = typeof num === 'string' && num.length > 3;
  return (
    <div aria-hidden="true">
      <div class="tf-row__lead">{lead}</div>
      <div class={`tf-row__num${long ? ' tf-row__num--long' : ''}`}>{num}</div>
      {unit && <div class="tf-row__unit">{unit}</div>}
    </div>
  );
}
