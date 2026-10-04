import type { TripResponse } from '../../../shared/api.ts';
import type { DirectionChoice } from '../lib/results.ts';
import { familyName } from '../lib/results.ts';

type Option<K> = { key: K; text: string; toward?: boolean };

// A row of choices, one pressed, saved with the search. Used for which way and which system.
export function Segmented<K extends string | null>({ label, options, selected, onChoose }: { label: string; options: Option<K>[]; selected: K; onChoose: (key: K) => void }) {
  const fixed = options.filter(({ key }) => key !== null).length;
  const columns = fixed === options.length ? `repeat(${fixed}, minmax(0, 1fr))` : `repeat(${fixed}, minmax(0, 1fr)) auto`;
  return (
    <div class="tf-seg" role="group" aria-label={label}>
      <div class="tf-kicker">{label}</div>
      <div class="tf-seg__options" style={{ gridTemplateColumns: columns }}>
        {options.map(({ key, text, toward }) => (
          <button key={key ?? 'all'} type="button" class="tf-seg__option" aria-pressed={selected === key} onClick={() => onChoose(key)}>
            {toward && (
              <span class="tf-seg__arrow" aria-hidden="true">
                →{' '}
              </span>
            )}
            {toward && <span class="tf-sr">toward </span>}
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

// Picks one direction of a route the results show in several.
export function DirectionSwitcher({ choice, data, onChoose }: { choice: DirectionChoice; data: TripResponse; onChoose: (key: string | null) => void }) {
  const options: Option<string | null>[] = [...choice.options.map(({ key, headsign }) => ({ key, text: headsign, toward: true })), { key: null, text: 'Both' }];
  return <Segmented label={`Which way on ${familyName(choice.routes, data)}`} options={options} selected={choice.selected} onChoose={onChoose} />;
}

// At a shared downtown station: ride or catch BART, Muni Metro, or either.
export function SystemSwitcher({ label, selected, onChoose }: { label: string; selected: 'BA' | 'SF' | undefined; onChoose: (system: 'BA' | 'SF' | undefined) => void }) {
  const options: Option<'BA' | 'SF' | 'both'>[] = [
    { key: 'BA', text: 'BART' },
    { key: 'SF', text: 'Muni Metro' },
    { key: 'both', text: 'Both' },
  ];
  return <Segmented label={label} options={options} selected={selected ?? 'both'} onChoose={(key) => onChoose(key === 'both' ? undefined : key)} />;
}
