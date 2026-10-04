import type { TripResponse } from '../../../shared/api.ts';
import type { DirectionChoice } from '../lib/results.ts';
import { chipLabel } from '../view.ts';

// Picks one direction of a route that the results show in several. Saved with the search.
export function DirectionSwitcher({ choice, data, onChoose }: { choice: DirectionChoice; data: TripResponse; onChoose: (key: string | null) => void }) {
  const routes = choice.routes.map((key) => data.routes[key]).filter((route) => route !== undefined);
  const name = routes[0]?.agency === 'BA' ? 'BART' : routes.map(chipLabel).join(', ');
  const label = `Which way on the ${name}`;
  const options = [...choice.options.map(({ key, headsign }) => ({ key, text: headsign })), { key: null, text: 'Both' }];
  return (
    <div class="tf-seg" role="group" aria-label={label}>
      <div class="tf-kicker">{label}</div>
      <div class="tf-seg__options" style={{ gridTemplateColumns: `repeat(${options.length - 1}, minmax(0, 1fr)) auto` }}>
        {options.map(({ key, text }) => (
          <button key={key ?? 'both'} type="button" class="tf-seg__option" aria-pressed={choice.selected === key} onClick={() => onChoose(key)}>
            {key !== null && (
              <span class="tf-seg__arrow" aria-hidden="true">
                →{' '}
              </span>
            )}
            {key !== null && <span class="tf-sr">toward </span>}
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
