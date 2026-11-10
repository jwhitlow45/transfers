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
