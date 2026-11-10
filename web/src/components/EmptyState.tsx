import type { ComponentChildren } from 'preact';

// What a page says in place of what it has none of, or could not load (`alert`): a title, and
// under it what the rider can do. With `id`, the title is the heading of the section that follows
// it, and `more` says in the same sentence what that section holds instead.
export function EmptyState({ title, alert, id, more, children }: { title: ComponentChildren; alert?: boolean; id?: string; more?: string; children?: ComponentChildren }) {
  const text = more ? (
    <>
      {title}. {more}
    </>
  ) : (
    title
  );
  return (
    <div class="tf-empty" role={alert ? 'alert' : undefined}>
      {id ? (
        <h2 class="tf-empty__title" id={id}>
          {text}
        </h2>
      ) : (
        <div class="tf-empty__title">{text}</div>
      )}
      {children}
    </div>
  );
}
