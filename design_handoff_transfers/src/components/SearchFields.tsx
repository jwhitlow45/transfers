import { IconSwap } from '../icons/ui';

export interface FieldValue { query: string; meta?: string }   // meta = "Muni · Stop 13477 · Eastbound, toward…" once picked

function Field({ label, v, ph, onChange, onFocus }: { label: string; v: FieldValue; ph: string; onChange: (q: string) => void; onFocus: () => void }) {
  return (
    <label className="tf-field">
      <span className="tf-kicker" style={{ fontWeight: 600 }}>{label}</span>
      <input value={v.query} placeholder={ph} autoComplete="off" onChange={e => onChange(e.target.value)} onFocus={onFocus} />
      {v.meta && <span className="tf-field__meta">{v.meta}</span>}
    </label>
  );
}

export function SearchFields({ from, to, onFrom, onTo, onFocus, onSwap }: {
  from: FieldValue; to: FieldValue; onFrom: (q: string) => void; onTo: (q: string) => void; onFocus: (f: 'from' | 'to') => void; onSwap: () => void;
}) {
  return (
    <div className="tf-fields">
      <div style={{ minWidth: 0 }}>
        <Field label="From" v={from} ph="Stop name or stop code" onChange={onFrom} onFocus={() => onFocus('from')} />
        <Field label="To" v={to} ph="Stop, stop code, or route" onChange={onTo} onFocus={() => onFocus('to')} />
      </div>
      <button className="tf-swap" onClick={onSwap} aria-label="Swap From and To"><IconSwap /></button>
    </div>
  );
}
