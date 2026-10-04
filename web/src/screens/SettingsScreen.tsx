import { ScreenHeader } from '../components/ResultsHeader.tsx';
import { Stepper, Toggle } from '../components/Sheet.tsx';
import { navigate } from '../router.ts';
import { useSettings } from '../settings.tsx';
import type { DeviceSettings } from '../storage.ts';

const SPEEDS = [
  { value: 0.9, label: 'Unhurried' },
  { value: 1.2, label: 'Average' },
  { value: 1.4, label: 'Brisk' },
  { value: 1.7, label: 'Fast' },
];
const WALKS = [200, 300, 400, 500, 650];
const CARDS: { value: DeviceSettings['cards']; label: string }[] = [
  { value: 'expanded', label: 'Expanded' },
  { value: 'first', label: 'First expanded' },
  { value: 'collapsed', label: 'Collapsed' },
];
const THEMES: { value: DeviceSettings['theme']; label: string }[] = [
  { value: 'system', label: 'Match this device' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

// Settings stored on this device that apply to every search unless a search sets its own.
export function SettingsScreen() {
  const { settings, update } = useSettings();
  const automatic = settings.min === null && settings.max === null;
  return (
    <div class="tf-scroll">
      <ScreenHeader title="Settings" onBack={() => navigate('/')} />
      <main class="tf-page tf-page--form" id="main">
        <p class="tf-muted tf-settings__intro">Saved on this device only. Each search can override these from its trip settings.</p>

        <section class="tf-section tf-section--tight" aria-labelledby="walking-heading">
          <h2 id="walking-heading">Walking</h2>
          <div class="tf-setting">
            <div class="tf-setting__label">Walking speed</div>
            <div class="tf-setting__help">Sets how long the walk between stops takes, and so the shortest transfer</div>
            <div class="tf-filters">
              {SPEEDS.map(({ value, label }) => (
                <Toggle key={value} pressed={settings.walkSpeed === value} onToggle={() => update({ walkSpeed: value })}>
                  {label}
                </Toggle>
              ))}
            </div>
          </div>
          <div class="tf-setting">
            <div class="tf-setting__label">Longest walk between stops</div>
            <div class="tf-setting__help">Walks to and from BART and Muni Metro stations can be up to 50% longer. 300 m is the default.</div>
            <div class="tf-filters">
              {WALKS.map((meters) => (
                <Toggle key={meters} pressed={settings.maxWalk === meters} onToggle={() => update({ maxWalk: meters })}>
                  {meters} m · {Math.max(1, Math.round((meters * 1.3) / settings.walkSpeed / 60))} min
                </Toggle>
              ))}
            </div>
          </div>
        </section>

        <section class="tf-section tf-section--tight" aria-labelledby="window-heading">
          <h2 id="window-heading">Transfer window</h2>
          <div class="tf-setting">
            <div class="tf-setting__label">Default window</div>
            <div class="tf-setting__help">Suggested works out each transfer from the walk, and widens it for routes that come rarely</div>
            <div class="tf-filters">
              <Toggle pressed={automatic} onToggle={() => update({ min: null, max: null })}>
                Suggested
              </Toggle>
              <Toggle pressed={!automatic} onToggle={() => update({ min: settings.min ?? 3, max: settings.max ?? 12 })}>
                Same for every trip
              </Toggle>
            </div>
          </div>
          {!automatic && (
            <>
              <Stepper label="Minimum transfer" help="Time to get between stops" value={settings.min ?? 3} onChange={(value) => update({ min: value, max: Math.max(settings.max ?? 12, value) })} />
              <Stepper label="Maximum transfer" help="Longest wait you will accept" value={settings.max ?? 12} min={1} onChange={(value) => update({ max: value, min: Math.min(settings.min ?? 3, value) })} />
            </>
          )}
          <Stepper label="Hide departures leaving in less than" help="Time to reach your first stop" value={settings.hide} onChange={(value) => update({ hide: value })} />
        </section>

        <section class="tf-section tf-section--tight" aria-labelledby="look-heading">
          <h2 id="look-heading">Appearance</h2>
          <div class="tf-setting">
            <div class="tf-setting__label">Theme</div>
            <div class="tf-filters">
              {THEMES.map(({ value, label }) => (
                <Toggle key={value} pressed={settings.theme === value} onToggle={() => update({ theme: value })}>
                  {label}
                </Toggle>
              ))}
            </div>
          </div>
          <div class="tf-setting">
            <div class="tf-setting__label">Departure cards</div>
            <div class="tf-setting__help">How cards start out on results. First expanded opens each group's soonest departure. Tap any card to open or close it.</div>
            <div class="tf-filters">
              {CARDS.map(({ value, label }) => (
                <Toggle key={value} pressed={settings.cards === value} onToggle={() => update({ cards: value })}>
                  {label}
                </Toggle>
              ))}
            </div>
          </div>
        </section>

        <section class="tf-section tf-section--tight" aria-labelledby="access-heading">
          <h2 id="access-heading">Accessibility</h2>
          <div class="tf-setting tf-setting--last">
            <div class="tf-setting__label">Step-free routes</div>
            <div class="tf-setting__help">Coming later: elevator routes through stations, longer transfers, and elevator outages first.</div>
          </div>
        </section>
      </main>
    </div>
  );
}
