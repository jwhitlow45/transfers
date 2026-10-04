import { IconChevronRight } from '../icons/ui.tsx';

export type RecentItem = { id: string; label: string; sub: string; href: string };

export function RecentList({ items, onOpen }: { items: RecentItem[]; onOpen: (item: RecentItem) => void }) {
  if (items.length === 0) return null;
  return (
    <section class="tf-section tf-section--tight" aria-labelledby="recent-heading">
      <h2 id="recent-heading">Recent</h2>
      {items.map((item) => (
        <a
          key={item.id}
          class="tf-recent"
          href={item.href}
          onClick={(event) => {
            event.preventDefault();
            onOpen(item);
          }}
        >
          <span class="tf-recent__text">
            <span class="tf-recent__label">{item.label}</span>
            <span class="tf-recent__sub">{item.sub}</span>
          </span>
          <span class="tf-muted">
            <IconChevronRight />
          </span>
        </a>
      ))}
    </section>
  );
}
