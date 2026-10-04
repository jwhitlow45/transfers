import type { Status } from '../view.ts';

// Lateness tag. Every arrival shows one, and it is never hidden to save space.
export function StatusTag({ status, plain = false }: { status: Status; plain?: boolean }) {
  return plain ? <span class={`tf-status-text tf-status-text--${status.kind}`}>{status.label}</span> : <span class={`tf-status tf-status--${status.kind}`}>{status.label}</span>;
}
