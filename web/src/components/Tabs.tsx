// Views of one page, such as a stop-to-stop search's trips and its transfers. Drawn as the app's
// other two-way choices are (see Segmented), with the label for screen readers alone.
export function Tabs<K extends string>({ label, options, selected, onChoose }: { label: string; options: { key: K; text: string }[]; selected: K; onChoose: (key: K) => void }) {
  return (
    <div class="tf-tabs tf-seg__options" role="tablist" aria-label={label} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map(({ key, text }) => (
        <button key={key} type="button" role="tab" class="tf-seg__option" aria-selected={selected === key} onClick={() => onChoose(key)}>
          {text}
        </button>
      ))}
    </div>
  );
}
