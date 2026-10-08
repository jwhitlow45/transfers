import type { ComponentChildren } from 'preact';
import { useId, useState } from 'preact/hooks';
import { IconChevron } from '../icons/ui.tsx';
import { Collapse } from './Collapse.tsx';

// Vehicles that have left, folded at the top of the rows or cards they left from, so the list
// leads with what the rider can still catch. They stay until their rides end, so a rider on one
// can open this and pin it.
export function Departed({ count, children }: { count: number; children: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <div class="tf-departed">
      <button type="button" class="tf-departed__toggle" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(!open)}>
        <IconChevron size={18} />
        {count} departed
      </button>
      <Collapse open={open} id={panel}>
        {children}
      </Collapse>
    </div>
  );
}
