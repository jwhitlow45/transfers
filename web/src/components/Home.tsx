import { useState } from 'preact/hooks';
import { navigate, tripPath } from '../router.ts';
import { type SavedSearch, type Search, loadRecent, loadSaved, saveSaved, searchId } from '../storage.ts';
import { type Picked, StopPicker } from './StopPicker.tsx';

// Prefills from Nearby land here through history state.
export function Home() {
  const prefill = (history.state ?? {}) as { from?: Picked; to?: Picked };
  const [from, setFrom] = useState<Picked | null>(prefill.from ?? null);
  const [to, setTo] = useState<Picked | null>(prefill.to ?? null);
  const [saved, setSaved] = useState(loadSaved);
  const recent = loadRecent().filter((search) => !saved.some((item) => searchId(item) === searchId(search)));

  const submit = (event: Event) => {
    event.preventDefault();
    if (!from || !to) return;
    navigate(tripPath({ from: from.key, to: to.key, fromLabel: from.label, toLabel: to.label }));
  };
  const swap = () => {
    // A route cannot be a From, so swapping only works between two stops.
    if (to?.key.startsWith('route:')) return;
    setFrom(to);
    setTo(from);
  };
  const updateSaved = (next: SavedSearch[]) => {
    saveSaved(next);
    setSaved(next);
  };

  return (
    <>
      <form class="search-form" onSubmit={submit} aria-label="Find a transfer">
        <StopPicker label="From" value={from} onPick={setFrom} placeholder="Stop name or number" />
        <button type="button" class="swap" onClick={swap} aria-label="Swap From and To" disabled={to?.key.startsWith('route:')}>
          ⇅
        </button>
        <StopPicker label="To" value={to} onPick={setTo} allowRoutes placeholder="Stop, number, or route" />
        <button type="submit" class="primary" disabled={!from || !to}>
          Show transfers
        </button>
      </form>

      <a class="nearby-link" href="/nearby" onClick={(event) => (event.preventDefault(), navigate('/nearby'))}>
        Show nearby
      </a>

      {saved.length > 0 && (
        <section aria-labelledby="saved-heading">
          <h2 id="saved-heading">Saved</h2>
          <ul class="search-list">
            {saved.map((search, index) => (
              <li key={search.id}>
                <a href={tripPath(search)} onClick={(event) => (event.preventDefault(), navigate(tripPath(search)))}>
                  <span class="search-name">{search.name}</span>
                  <span class="search-detail">
                    {search.fromLabel} → {search.toLabel}
                  </span>
                </a>
                <SavedActions
                  search={search}
                  first={index === 0}
                  last={index === saved.length - 1}
                  onRename={(name) => updateSaved(saved.map((item) => (item.id === search.id ? { ...item, name } : item)))}
                  onMove={(offset) => {
                    const next = [...saved];
                    next.splice(index, 1);
                    next.splice(index + offset, 0, search);
                    updateSaved(next);
                  }}
                  onDelete={() => updateSaved(saved.filter((item) => item.id !== search.id))}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {recent.length > 0 && (
        <section aria-labelledby="recent-heading">
          <h2 id="recent-heading">Recent</h2>
          <ul class="search-list">
            {recent.map((search) => (
              <li key={searchId(search)}>
                <a href={tripPath(search)} onClick={(event) => (event.preventDefault(), navigate(tripPath(search)))}>
                  <span class="search-detail">
                    {search.fromLabel} → {search.toLabel}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function SavedActions(props: {
  search: SavedSearch;
  first: boolean;
  last: boolean;
  onRename: (name: string) => void;
  onMove: (offset: number) => void;
  onDelete: () => void;
}) {
  return (
    <details class="saved-actions">
      <summary aria-label={`Options for ${props.search.name}`}>⋯</summary>
      <div class="saved-actions-menu">
        <button type="button" onClick={() => { const name = prompt('Name this search', props.search.name)?.trim(); if (name) props.onRename(name); }}>
          Rename
        </button>
        <button type="button" disabled={props.first} onClick={() => props.onMove(-1)}>
          Move up
        </button>
        <button type="button" disabled={props.last} onClick={() => props.onMove(1)}>
          Move down
        </button>
        <button type="button" onClick={props.onDelete}>
          Delete
        </button>
      </div>
    </details>
  );
}

export function saveSearch(search: Search, name: string) {
  const saved = loadSaved().filter((item) => item.id !== searchId(search));
  saveSaved([...saved, { ...search, id: searchId(search), name }]);
}
