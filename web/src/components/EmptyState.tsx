import type { ComponentChildren } from 'preact';

// What a page says in place of what it has none of, or could not load (`alert`): a title, and
// under it what the rider can do.
export function EmptyState({ title, alert, children }: { title: ComponentChildren; alert?: boolean; children?: ComponentChildren }) {
  return (
    <div class="tf-empty" role={alert ? 'alert' : undefined}>
      <div class="tf-empty__title">{title}</div>
      {children}
    </div>
  );
}
