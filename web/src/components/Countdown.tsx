import type { ComponentChildren } from 'preact';

// The countdown column of a results row or a pinned card: what is next in small capitals, its
// minutes large, and their unit under them. Hidden from screen readers, as each card says all of
// it in its spoken summary.
export function Countdown({ lead, num, unit }: { lead: ComponentChildren; num: ComponentChildren; unit: string | null }) {
  return (
    <div aria-hidden="true">
      <div class="tf-row__lead">{lead}</div>
      <div class="tf-row__num">{num}</div>
      {unit && <div class="tf-row__unit">{unit}</div>}
    </div>
  );
}
