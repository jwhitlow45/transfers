// Views of one page, such as a stop-to-stop search's trips and its transfers, drawn as the app's
// other two-way choices are (see Segmented). As tabs are, it is one stop for Tab, the arrow keys,
// Home and End choose among them, and each names `panel`, which shows the one chosen (see
// tabPanel). Choosing is showing, so focus moving to a tab chooses it.
export function Tabs<K extends string>({ label, options, selected, panel, onChoose }: {
  label: string;
  options: { key: K; text: string }[];
  selected: K;
  panel: string;
  onChoose: (key: K) => void;
}) {
  const move = (event: KeyboardEvent) => {
    const index = options.findIndex(({ key }) => key === selected);
    const last = options.length - 1;
    const steps: Record<string, number> = { ArrowRight: index === last ? 0 : index + 1, ArrowLeft: index === 0 ? last : index - 1, Home: 0, End: last };
    const next = steps[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const key = options[next]!.key;
    onChoose(key);
    document.getElementById(tabId(panel, key))?.focus();
  };
  return (
    <div class="tf-tabs tf-seg__options" role="tablist" aria-label={label} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }} onKeyDown={move}>
      {options.map(({ key, text }) => (
        <button
          key={key}
          id={tabId(panel, key)}
          type="button"
          role="tab"
          class="tf-seg__option"
          aria-selected={selected === key}
          aria-controls={panel}
          tabIndex={selected === key ? 0 : -1}
          onClick={() => onChoose(key)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

const tabId = (panel: string, key: string) => `${panel}-${key}`;

// The attributes of the view a set of tabs shows.
export const tabPanel = (panel: string, selected: string) => ({ id: panel, role: 'tabpanel', 'aria-labelledby': tabId(panel, selected), class: 'tf-tabpanel' }) as const;
