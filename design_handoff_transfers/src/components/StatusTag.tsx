import type { Status } from '../lib/status';

/** Lateness tag. Every arrival shows one; it is never hidden to save space. */
export function StatusTag({ status, plain = false }: { status: Status; plain?: boolean }) {
  return plain
    ? <span className={`tf-status-text tf-status-text--${status.kind}`}>{status.label}</span>
    : <span className={`tf-status tf-status--${status.kind}`}>{status.label}</span>;
}
