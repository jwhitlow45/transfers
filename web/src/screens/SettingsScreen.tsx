import { ScreenHeader } from '../components/ResultsHeader.tsx';
import { Choices, Toggle } from '../components/Sheet.tsx';
import { MinutesSlider, WindowSlider } from '../components/Slider.tsx';
import { useSwipeBack } from '../gestures.ts';
import { goBack, navigate } from '../router.ts';
import { useSettings } from '../settings.tsx';
import { type DeviceSettings, MAX_UNPIN_MINUTES, clearCached } from '../storage.ts';

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
const MOTIONS: { value: DeviceSettings['motion']; label: string }[] = [
  { value: 'system', label: 'Match this device' },
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];
const THEMES: { value: DeviceSettings['theme']; label: string }[] = [
  { value: 'system', label: 'Match this device' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

// Settings stored on this device that apply to every search unless a search sets its own.
export function SettingsScreen() {
  const { settings, update } = useSettings();
  useSwipeBack(() => goBack());
  const automatic = settings.min === null && settings.max === null;
  return (
    <div class="tf-scroll">
      <ScreenHeader title="Settings" onBack={() => goBack()} />
      <main class="tf-page tf-page--form" id="main">
        <p class="tf-muted tf-settings__intro">Saved on this device only. Each search can override these from its trip settings.</p>

        <section class="tf-section tf-section--tight" aria-labelledby="walking-heading">
          <h2 id="walking-heading">Walking</h2>
          <div class="tf-setting">
            <div class="tf-setting__label">Walking speed</div>
            <div class="tf-setting__help">Sets how long the walk between stops takes, and so the shortest transfer</div>
            <Choices label="Walking speed" options={SPEEDS.map(({ value, label }) => ({ key: value, text: label }))} selected={settings.walkSpeed} onChoose={(walkSpeed) => update({ walkSpeed })} />
          </div>
          <div class="tf-setting">
            <div class="tf-setting__label">Longest walk between stops</div>
            <div class="tf-setting__help">Walks to and from BART and Muni Metro stations can be up to 50% longer. 300 m is the default.</div>
            <Choices
              label="Longest walk between stops"
              options={WALKS.map((meters) => ({ key: meters, text: `${meters} m · ${Math.max(1, Math.round((meters * 1.3) / settings.walkSpeed / 60))} min` }))}
              selected={settings.maxWalk}
              onChoose={(maxWalk) => update({ maxWalk })}
            />
          </div>
        </section>

        <section class="tf-section tf-section--tight" aria-labelledby="window-heading">
          <h2 id="window-heading">Transfer window</h2>
          <div class="tf-setting">
            <div class="tf-setting__label">Default window</div>
            <div class="tf-setting__help">Suggested works out each transfer from the walk, and widens it for routes that come rarely</div>
            <Choices
              label="Default window"
              options={[
                { key: 'suggested', text: 'Suggested' },
                { key: 'fixed', text: 'Same for every trip' },
              ]}
              selected={automatic ? 'suggested' : 'fixed'}
              onChoose={(choice) => update(choice === 'suggested' ? { min: null, max: null } : { min: settings.min ?? 3, max: settings.max ?? 12 })}
            />
          </div>
          {!automatic && (
            <WindowSlider
              label="Window for every trip"
              help="Shortest time to get between stops, and longest wait you will accept"
              window={{ min: settings.min ?? 3, max: settings.max ?? 12 }}
              onChange={({ min, max }) => update({ min, max })}
            />
          )}
        </section>

        {/* Its own section: hiding departures works the same with either window choice above. */}
        <section class="tf-section tf-section--tight" aria-labelledby="departures-heading">
          <h2 id="departures-heading">Departures</h2>
          <MinutesSlider label="Hide departures leaving in less than" help="Time to reach your first stop" value={settings.hide} onChange={(value) => update({ hide: value })} />
        </section>

        <section class="tf-section tf-section--tight" aria-labelledby="map-heading">
          <h2 id="map-heading">Live map</h2>
          <div class="tf-setting">
            <div class="tf-setting__label">Zoom after boarding</div>
            <div class="tf-setting__help">When the vehicle leaves your stop, the map drops the ride before it and fits what is left. Fit on the map does this any time.</div>
            <div class="tf-filters">
              <Toggle pressed={settings.mapFitOnBoard} onToggle={() => update({ mapFitOnBoard: !settings.mapFitOnBoard })}>
                Zoom in once you board
              </Toggle>
            </div>
          </div>
        </section>

        <section class="tf-section tf-section--tight" aria-labelledby="pinned-heading">
          <h2 id="pinned-heading">Pinned trips</h2>
          <div class="tf-setting">
            <div class="tf-setting__label">Unpin when done</div>
            <div class="tf-setting__help">A trip ends when you reach your destination, or with none set, when you board the vehicle you transfer to.</div>
            <div class="tf-filters">
              <Toggle pressed={settings.autoUnpin} onToggle={() => update({ autoUnpin: !settings.autoUnpin })}>
                Unpin after the trip ends
              </Toggle>
            </div>
          </div>
          {settings.autoUnpin && (
            <MinutesSlider
              label="Unpin this long after it ends"
              help="Until then the trip stays at the top of its results"
              value={settings.unpinAfter}
              max={MAX_UNPIN_MINUTES}
              step={5}
              onChange={(value) => update({ unpinAfter: value })}
            />
          )}
        </section>

        <section class="tf-section tf-section--tight" aria-labelledby="look-heading">
          <h2 id="look-heading">Appearance</h2>
          <div class="tf-setting">
            <div class="tf-setting__label">Theme</div>
            <Choices label="Theme" options={THEMES.map(({ value, label }) => ({ key: value, text: label }))} selected={settings.theme} onChoose={(theme) => update({ theme })} />
          </div>
          <div class="tf-setting">
            <div class="tf-setting__label">Transit icons</div>
            <div class="tf-setting__help">The vehicle pictures beside route names</div>
            <div class="tf-filters">
              <Toggle pressed={settings.modeIcons} onToggle={() => update({ modeIcons: !settings.modeIcons })}>
                Show transit icons
              </Toggle>
            </div>
          </div>
          <div class="tf-setting">
            <div class="tf-setting__label">Departure cards</div>
            <div class="tf-setting__help">How cards start out on results. First expanded opens each group's soonest departure. Tap any card to open or close it.</div>
            <Choices label="Departure cards" options={CARDS.map(({ value, label }) => ({ key: value, text: label }))} selected={settings.cards} onChoose={(cards) => update({ cards })} />
          </div>
        </section>

        <section class="tf-section tf-section--tight" aria-labelledby="access-heading">
          <h2 id="access-heading">Accessibility</h2>
          <div class="tf-setting">
            <div class="tf-setting__label">Animations</div>
            <div class="tf-setting__help">Sections opening and closing, sheets sliding, and the refresh bar. Match this device follows its reduce motion setting.</div>
            <Choices label="Animations" options={MOTIONS.map(({ value, label }) => ({ key: value, text: label }))} selected={settings.motion} onChoose={(motion) => update({ motion })} />
          </div>
          <div class="tf-setting">
            <div class="tf-setting__label">Step-free travel</div>
            <div class="tf-setting__help">Marks elevator outages at your stations, each opening what BART says about it, and allows 3 more minutes to change at BART and Muni Metro stations, unless you set your own minimum. Muni's outages come from its service alerts, with the other notices.</div>
            <div class="tf-filters">
              <Toggle pressed={settings.stepFree} onToggle={() => update({ stepFree: !settings.stepFree })}>
                I use elevators
              </Toggle>
            </div>
          </div>
          <div class="tf-setting tf-setting--last">
            <div class="tf-setting__label">Escalator outages</div>
            <div class="tf-setting__help">Marks escalators out of service at BART stations on your trip, from bart.gov's status pages.</div>
            <div class="tf-filters">
              <Toggle pressed={settings.escalatorOutages} onToggle={() => update({ escalatorOutages: !settings.escalatorOutages })}>
                Show escalator outages
              </Toggle>
            </div>
          </div>
        </section>

        <section class="tf-section tf-section--tight" aria-labelledby="app-heading">
          <h2 id="app-heading">App</h2>
          <div class="tf-setting">
            <div class="tf-setting__label">Dismissed notices</div>
            <div class="tf-setting__help">Notices you dismiss stay hidden on every trip until you restore them.</div>
            <a class="tf-link-button" href="/notices" onClick={(event) => (event.preventDefault(), navigate('/notices'))}>
              Show dismissed notices
            </a>
          </div>
          <div class="tf-setting tf-setting--last">
            <div class="tf-setting__label">Force refresh</div>
            <div class="tf-setting__help">The site keeps a copy of itself and your last results so it opens offline. This clears both and reloads, for when something looks out of date. Your settings and saved trips stay.</div>
            <button type="button" class="tf-btn-outline tf-force-refresh" onClick={() => void forceRefresh()}>
              Force refresh site
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}

// Drops the service worker and its copy of the site, and the stored responses, then reloads, so
// the page and its data come fresh from the server.
async function forceRefresh() {
  try {
    const registrations = (await navigator.serviceWorker?.getRegistrations()) ?? [];
    await Promise.all(registrations.map((registration) => registration.unregister()));
    if ('caches' in window) await Promise.all((await caches.keys()).map((name) => caches.delete(name)));
  } catch {
    // A browser that refuses still reloads below, which fetches what it can.
  }
  clearCached();
  location.reload();
}
