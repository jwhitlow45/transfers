import type { ComponentChildren } from 'preact';

// The number column of a row, the same on every page: the minutes the rider acts on, large, over
// their unit. It carries no label such as "Leaves in", as the row beside it says what the number
// counts to. Hidden from screen readers, as each row says all of it in its spoken summary.
export function Num({ n, unit }: { n: ComponentChildren; unit?: string | null }) {
  return (
    <span class="tf-num" aria-hidden="true">
      <span class="tf-num__n">{n}</span>
      {unit && <span class="tf-num__u">{unit}</span>}
    </span>
  );
}

// The countdown column of a pinned card, from before rows took Num: what is next in small capitals, its
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
