import { createContext } from 'preact';
import { useContext, useLayoutEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { DEFAULT_SETTINGS, type DeviceSettings, loadSettings, saveSettings } from './storage.ts';

const SettingsContext = createContext<{ settings: DeviceSettings; update: (change: Partial<DeviceSettings>) => void }>({
  settings: DEFAULT_SETTINGS,
  update: () => {},
});

export function SettingsProvider({ children }: { children: ComponentChildren }) {
  const [settings, setSettings] = useState(loadSettings);
  // Layout effects, so the theme and motion settings hold from the first paint, before a page
  // opened from the cache can flash the wrong colors or start an animation.
  useLayoutEffect(() => {
    if (settings.theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);
  // Every animation in the site checks this one attribute: styles.css turns them all off under
  // it, and gestures read it through motionOff(). Matching the device follows its reduce motion
  // setting, including when it changes while the page is open.
  useLayoutEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      const off = settings.motion === 'off' || (settings.motion === 'system' && reduce.matches);
      document.documentElement.dataset.motion = off ? 'off' : 'on';
    };
    apply();
    reduce.addEventListener('change', apply);
    return () => reduce.removeEventListener('change', apply);
  }, [settings.motion]);
  const update = (change: Partial<DeviceSettings>) =>
    setSettings((current) => {
      const next = { ...current, ...change };
      saveSettings(next);
      return next;
    });
  return <SettingsContext.Provider value={{ settings, update }}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);

// Whether the server's inlined results answer the same question this device would ask.
export function matchesServerDefaults(settings: DeviceSettings) {
  return settings.maxWalk === DEFAULT_SETTINGS.maxWalk && settings.walkSpeed === DEFAULT_SETTINGS.walkSpeed && settings.min === null && settings.max === null && settings.hide === 0 && !settings.showHidden && !settings.stepFree && settings.elevatorOutages && settings.escalatorOutages;
}
