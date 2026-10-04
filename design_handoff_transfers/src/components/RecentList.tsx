import { IconChevronRight } from '../icons/ui';
import type { RecentSearch } from '../types';

export function RecentList({ items, onOpen }: { items: RecentSearch[]; onOpen: (r: RecentSearch) => void }) {
  return (
    <section className="tf-section" style={{ gap: 4 }}>
      <h2>Recent</h2>
      {items.map(r => (
        <button key={r.id} className="tf-recent" onClick={() => onOpen(r)}>
          <span className="tf-recent__text"><span className="tf-recent__label">{r.label}</span><span className="tf-recent__sub">{r.sub}</span></span>
          <span className="tf-muted"><IconChevronRight /></span>
        </button>
      ))}
    </section>
  );
}
