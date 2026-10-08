import { IconSwap } from '../icons/ui.tsx';
import { typeWithoutUndo } from '../typing.ts';

// meta is "Muni · Stop 13477 · Eastbound, toward 22nd St + Iowa St" once a result is picked.
export type FieldValue = { query: string; meta?: string };

function Field({ id, label, value, placeholder, enterKeyHint, onChange, onFocus, onEnter }: {
  id: string;
  label: string;
  value: FieldValue;
  placeholder: string;
  enterKeyHint: 'next' | 'go';
  onChange: (query: string) => void;
  onFocus: () => void;
  onEnter: () => void;
}) {
  return (
    <label class="tf-field">
      <span class="tf-kicker tf-field__label">{label}</span>
      <input
        id={id}
        type="text"
        value={value.query}
        placeholder={placeholder}
        autocomplete="off"
        autocapitalize="off"
        spellcheck={false}
        enterKeyHint={enterKeyHint}
        onBeforeInput={typeWithoutUndo}
        onInput={(event) => onChange(event.currentTarget.value)}
        onFocus={onFocus}
        onKeyDown={(event) => {
          // Not while an input method is composing, where Enter settles the text.
          if (event.key !== 'Enter' || event.isComposing) return;
          event.preventDefault();
          onEnter();
        }}
      />
      {value.meta && <span class="tf-field__meta">{value.meta}</span>}
    </label>
  );
}

export function SearchFields({ from, to, onFrom, onTo, onFocus, onEnter, onSwap, canSwap }: {
  from: FieldValue;
  to: FieldValue;
  onFrom: (query: string) => void;
  onTo: (query: string) => void;
  onFocus: (field: 'from' | 'to') => void;
  onEnter: (field: 'from' | 'to') => void;
  onSwap: () => void;
  canSwap: boolean;
}) {
  return (
    <div class="tf-fields">
      <div class="tf-fields__stack">
        {/* The keyboard's Enter says where it goes: on to To, or to the results once From is picked. */}
        <Field id="field-from" label="From" value={from} placeholder="Stop name or stop code" enterKeyHint={to.meta ? 'go' : 'next'} onChange={onFrom} onFocus={() => onFocus('from')} onEnter={() => onEnter('from')} />
        <Field id="field-to" label="To" value={to} placeholder="Stop, stop code, or route" enterKeyHint={from.meta ? 'go' : 'next'} onChange={onTo} onFocus={() => onFocus('to')} onEnter={() => onEnter('to')} />
      </div>
      <button type="button" class="tf-swap" onClick={onSwap} disabled={!canSwap} aria-label="Swap From and To">
        <IconSwap />
      </button>
    </div>
  );
}
