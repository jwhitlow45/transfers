import { IconSwap } from '../icons/ui.tsx';
import { typeWithoutUndo } from '../typing.ts';

// meta is "Muni · Stop 13477 · Eastbound, toward 22nd St + Iowa St" once a result is picked.
export type FieldValue = { query: string; meta?: string };

function Field({ label, value, placeholder, onChange, onFocus }: { label: string; value: FieldValue; placeholder: string; onChange: (query: string) => void; onFocus: () => void }) {
  return (
    <label class="tf-field">
      <span class="tf-kicker tf-field__label">{label}</span>
      <input
        type="text"
        value={value.query}
        placeholder={placeholder}
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        enterKeyHint="search"
        onBeforeInput={typeWithoutUndo}
        onInput={(event) => onChange(event.currentTarget.value)}
        onFocus={onFocus}
      />
      {value.meta && <span class="tf-field__meta">{value.meta}</span>}
    </label>
  );
}

export function SearchFields({ from, to, onFrom, onTo, onFocus, onSwap, canSwap }: {
  from: FieldValue;
  to: FieldValue;
  onFrom: (query: string) => void;
  onTo: (query: string) => void;
  onFocus: (field: 'from' | 'to') => void;
  onSwap: () => void;
  canSwap: boolean;
}) {
  return (
    <div class="tf-fields">
      <div class="tf-fields__stack">
        <Field label="From" value={from} placeholder="Stop name or stop code" onChange={onFrom} onFocus={() => onFocus('from')} />
        <Field label="To" value={to} placeholder="Stop, stop code, or route" onChange={onTo} onFocus={() => onFocus('to')} />
      </div>
      <button type="button" class="tf-swap" onClick={onSwap} disabled={!canSwap} aria-label="Swap From and To">
        <IconSwap />
      </button>
    </div>
  );
}
