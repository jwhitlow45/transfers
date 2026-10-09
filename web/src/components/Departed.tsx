import type { ComponentChildren } from 'preact';
import { Fold } from './Fold.tsx';

// Vehicles that have left From, folded at the top of the rows or cards they left from, so the list
// leads with what the rider can still catch. They stay until their rides end, so a rider on one
// can open this and pin it. "2 already left Montgomery St" says what left, as a card's later bus
// may still be on its way (J, 2026-10-08).
export function Departed({ count, place, children }: { count: number; place: string; children: ComponentChildren }) {
  return (
    <div class="tf-departed">
      <Fold class="tf-departed__toggle" label={`${count} already left ${place}`}>
        <div class="tf-departed__list">{children}</div>
      </Fold>
    </div>
  );
}
