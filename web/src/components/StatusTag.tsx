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
