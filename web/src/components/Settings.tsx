import { useSettings } from '../settings.tsx';
import type { DeviceSettings } from '../storage.ts';

const SPEEDS = [
  { value: 0.9, label: 'Unhurried' },
  { value: 1.2, label: 'Average' },
  { value: 1.4, label: 'Brisk (default)' },
  { value: 1.7, label: 'Fast' },
];

const WALKS = [200, 300, 400, 500, 650];

// Settings stored on this device that apply to every search unless a search sets its own.
export function Settings() {
  const { settings, update } = useSettings();
  const numberOrNull = (text: string) => (text === '' ? null : Math.max(0, Math.round(Number(text))));
  return (
    <form class="settings" onSubmit={(event) => event.preventDefault()}>
      <h1>Settings</h1>
      <p class="hint">Saved on this device only.</p>

      <label>
        Walking speed
        <select value={String(settings.walkSpeed)} onChange={(event) => update({ walkSpeed: Number(event.currentTarget.value) })}>
          {SPEEDS.map(({ value, label }) => (
            <option key={value} value={String(value)}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Longest walk between stops
        <select value={String(settings.maxWalk)} onChange={(event) => update({ maxWalk: Number(event.currentTarget.value) })}>
          {WALKS.map((meters) => (
            <option key={meters} value={String(meters)}>
              {meters} m{meters === 300 ? ' (default)' : ''}
            </option>
          ))}
        </select>
        <span class="hint">Walks to and from rail stations may run half again as far.</span>
      </label>

      <fieldset>
        <legend>Default transfer window</legend>
        <p class="hint">Leave blank to use each transfer's own estimate, based on the walk.</p>
        <label>
          Shortest, in minutes
          <input type="number" inputMode="numeric" min="0" max="60" value={settings.min ?? ''} onChange={(event) => update({ min: numberOrNull(event.currentTarget.value) })} />
        </label>
        <label>
          Longest, in minutes
          <input type="number" inputMode="numeric" min="0" max="120" value={settings.max ?? ''} onChange={(event) => update({ max: numberOrNull(event.currentTarget.value) })} />
        </label>
      </fieldset>

      <label>
        Hide departures leaving in less than (minutes)
        <input type="number" inputMode="numeric" min="0" max="60" value={settings.hide} onChange={(event) => update({ hide: numberOrNull(event.currentTarget.value) ?? 0 })} />
      </label>

      <fieldset>
        <legend>Theme</legend>
        {(['system', 'light', 'dark'] as DeviceSettings['theme'][]).map((theme) => (
          <label key={theme} class="radio">
            <input type="radio" name="theme" checked={settings.theme === theme} onChange={() => update({ theme })} />
            {theme === 'system' ? 'Match this device' : theme[0]!.toUpperCase() + theme.slice(1)}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Accessibility</legend>
        <p class="hint">A step-free mode, with elevator routes and longer transfers, is planned.</p>
      </fieldset>
    </form>
  );
}
