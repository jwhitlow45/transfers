import type { ComponentChildren } from 'preact';
import { useId, useState } from 'preact/hooks';
import { IconFold } from '../icons/ui.tsx';
import { Collapse } from './Collapse.tsx';

// A fold of what the rider can do without at first: a chevron and its label, which open what
// follows them below. `class` styles the button where it sits.
export function Fold({ class: className, label, children }: { class: string; label: ComponentChildren; children: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <>
      <button type="button" class={`tf-fold ${className}`} aria-expanded={open} aria-controls={panel} onClick={() => setOpen(!open)}>
        <IconFold />
        {label}
      </button>
      <Collapse open={open} id={panel}>
        {children}
      </Collapse>
    </>
  );
}
