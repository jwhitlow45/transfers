import { useRef } from 'preact/hooks';
import { IconClose, IconSwap } from '../icons/ui.tsx';
import { typeWithoutUndo } from '../typing.ts';

// meta is "Muni · Stop 13477 · Eastbound, toward 22nd St + Iowa St" once a result is picked.
export type FieldValue = { query: string; meta?: string };

function Field({ id, label, value, placeholder, enterKeyHint, onChange, onFocus, onBlur, onEnter }: {
  id: string;
  label: string;
  value: FieldValue;
  placeholder: string;
  enterKeyHint: 'next' | 'go';
  onChange: (query: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onEnter: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <label class="tf-field">
      <span class="tf-kicker tf-field__label">{label}</span>
      <span class="tf-field__row">
        <input
          ref={input}
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
          onFocus={(event) => {
            // A picked stop is replaced, not edited, so a tap selects it all for typing over.
            const field = event.currentTarget;
            if (value.meta) setTimeout(() => field.setSelectionRange(0, field.value.length));
            onFocus();
          }}
          onBlur={onBlur}
          onKeyDown={(event) => {
            // Not while an input method is composing, where Enter settles the text.
            if (event.key !== 'Enter' || event.isComposing) return;
            event.preventDefault();
            onEnter();
          }}
        />
        {value.query && (
          <button
            type="button"
            class="tf-field__clear"
            aria-label={`Clear ${label}`}
            onClick={(event) => {
              event.preventDefault();
              onChange('');
              input.current?.focus();
            }}
          >
            <IconClose size={18} />
          </button>
        )}
      </span>
      {value.meta && <span class="tf-field__meta">{value.meta}</span>}
    </label>
  );
}

export function SearchFields({ from, to, onFrom, onTo, onFocus, onBlur, onEnter, onSwap, canSwap }: {
  from: FieldValue;
  to: FieldValue;
  onFrom: (query: string) => void;
  onTo: (query: string) => void;
  onFocus: (field: 'from' | 'to') => void;
  onBlur: () => void;
  onEnter: (field: 'from' | 'to') => void;
  onSwap: () => void;
  canSwap: boolean;
}) {
  return (
    <div class="tf-fields">
      <div class="tf-fields__stack">
        {/* The keyboard's Enter says where it goes: from From on to To, and from To to the results
            once From is picked. */}
        <Field id="field-from" label="From" value={from} placeholder="Stop, stop code, or your location" enterKeyHint="next" onChange={onFrom} onFocus={() => onFocus('from')} onBlur={onBlur} onEnter={() => onEnter('from')} />
        <Field id="field-to" label="To" value={to} placeholder="Stop, stop code, or route" enterKeyHint={from.meta ? 'go' : 'next'} onChange={onTo} onFocus={() => onFocus('to')} onBlur={onBlur} onEnter={() => onEnter('to')} />
      </div>
      <button type="button" class="tf-swap" onClick={onSwap} disabled={!canSwap} aria-label="Swap From and To">
        <IconSwap />
      </button>
    </div>
  );
}
