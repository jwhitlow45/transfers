import type { ComponentChildren } from 'preact';
import { clock, numSize } from '../format.ts';
import { Approx } from './StatusTag.tsx';

// The number column of a row, the same on every page: the minutes the rider acts on, large, over
// their unit. It carries no label such as "Leaves in", as the row beside it says what the number
// counts to. Hidden from screen readers, as each row says all of it in its spoken summary.
export function Num({ n, unit }: { n: ComponentChildren; unit?: ComponentChildren }) {
  return (
    <span class="tf-num" aria-hidden="true">
      <span class={`tf-num__n${numSize(n)}`}>{n}</span>
      {unit && <span class="tf-num__u">{unit}</span>}
    </span>
  );
}

// A clock time in the number column, where a step has no countdown: the time where a row has its
// number, over "AM" or "PM" where it has its unit, so it fits the column every row shares. A time
// from the schedule alone carries its "~" (see approx), which a screen reader hears as "scheduled".
export function Clock({ at, scheduled = false }: { at: number; scheduled?: boolean }) {
  const [time, period] = clock(at).split('\u00a0');
  return (
    <>
      <span class="tf-num__clock">
        <Approx scheduled={scheduled}>{time}</Approx>
      </span>{' '}
      <span class="tf-num__u">{period}</span>
    </>
  );
}
