import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { RouteSearchResult, SearchResponse, StopSearchResult } from '../../../shared/api.ts';
import { getJson } from '../api.ts';
import { RouteBadge } from './RouteBadge.tsx';

export type Picked = { key: string; label: string };

type Props = {
  label: string;
  value: Picked | null;
  onPick: (picked: Picked | null) => void;
  // The To field also offers routes, such as "the 22".
  allowRoutes?: boolean;
  placeholder?: string;
};

// A combobox that searches stops by name or the code on the pole, following the WAI-ARIA
// combobox pattern so it works with a keyboard and a screen reader.
export function StopPicker({ label, value, onPick, allowRoutes = false, placeholder }: Props) {
  const id = useId();
  const [text, setText] = useState(value?.label ?? '');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setText(value?.label ?? ''), [value?.key, value?.label]);

  useEffect(() => {
    const query = text.trim();
    if (!open || !query || query === value?.label) {
      setResponse(null);
      return;
    }
    const controller = new AbortController();
    // Waits for a pause in typing, so each keystroke does not cost a request.
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query, kind: allowRoutes ? 'any' : 'stop' });
      getJson<SearchResponse>(`/api/search?${params}`, { signal: controller.signal })
        .then((result) => {
          setResponse(result);
          setActive(-1);
          setStatus(result.results.length === 0 ? 'No matches' : `${result.results.length} results`);
        })
        .catch((error: Error) => {
          if (error.name !== 'AbortError') setStatus('Search is unavailable offline');
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text, open, allowRoutes]);

  const results = response?.results ?? [];
  const choose = (result: StopSearchResult | RouteSearchResult) => {
    const picked = result.type === 'stop' ? { key: result.key, label: stopLabel(result) } : { key: `route:${result.route}`, label: routeLabel(response!, result) };
    onPick(picked);
    setText(picked.label);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(results.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(-1, index - 1));
    } else if (event.key === 'Enter' && open && active >= 0 && results[active]) {
      event.preventDefault();
      choose(results[active]!);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  const listId = `${id}-list`;
  return (
    <div class="picker">
      <label for={`${id}-input`}>{label}</label>
      <div class="picker-row">
        <input
          ref={input}
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-expanded={open && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${id}-option-${active}` : undefined}
          autocomplete="off"
          enterKeyHint="search"
          placeholder={placeholder}
          value={text}
          onInput={(event) => {
            setText(event.currentTarget.value);
            setOpen(true);
            if (value) onPick(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
        />
      </div>
      <ul id={listId} role="listbox" class="picker-list" hidden={!open || results.length === 0} aria-label={`${label} results`}>
        {results.map((result, index) => (
          <li
            key={result.type === 'stop' ? result.key : result.route}
            id={`${id}-option-${index}`}
            role="option"
            aria-selected={index === active}
            class={index === active ? 'active' : ''}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose(result)}
          >
            {result.type === 'stop' ? <StopOption result={result} response={response!} /> : <RouteOption result={result} response={response!} />}
          </li>
        ))}
      </ul>
      <div class="visually-hidden" role="status" aria-live="polite">
        {open ? status : ''}
      </div>
    </div>
  );
}

function StopOption({ result, response }: { result: StopSearchResult; response: SearchResponse }) {
  const details = [result.code && `Stop ${result.code}`, result.direction, result.toward.length > 0 && `toward ${result.toward.join(', ')}`].filter(Boolean);
  return (
    <>
      <span class="option-name">{result.name}</span>
      {details.length > 0 && <span class="option-detail">{details.join(' · ')}</span>}
      <span class="option-routes">
        {result.routes.map((key) => (
          <RouteBadge key={key} route={response.routes[key]} size="small" />
        ))}
      </span>
    </>
  );
}

function RouteOption({ result, response }: { result: RouteSearchResult; response: SearchResponse }) {
  const route = response.routes[result.route];
  return (
    <>
      <span class="option-name">
        <RouteBadge route={route} size="small" /> {route?.longName}
      </span>
      <span class="option-detail">Route · {result.directions.map(({ name, headsign }) => [name, headsign].filter(Boolean).join(' to ')).join(' · ')}</span>
    </>
  );
}

function stopLabel(result: StopSearchResult) {
  return [result.name, result.code ? `(${result.code})` : '', result.direction && result.agency !== 'BA' ? result.direction : ''].filter(Boolean).join(' ');
}

function routeLabel(response: SearchResponse, result: RouteSearchResult) {
  const route = response.routes[result.route];
  return route ? `${route.name} ${route.longName}`.trim() : result.route;
}
