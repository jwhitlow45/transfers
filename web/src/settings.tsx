import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { DEFAULT_SETTINGS, type DeviceSettings, type Search, loadSettings, saveSettings } from './storage.ts';

const SettingsContext = createContext<{ settings: DeviceSettings; update: (change: Partial<DeviceSettings>) => void }>({
  settings: DEFAULT_SETTINGS,
  update: () => {},
});

export function SettingsProvider({ children }: { children: ComponentChildren }) {
  const [settings, setSettings] = useState(loadSettings);
  useEffect(() => {
    if (settings.theme === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', settings.theme);
  }, [settings.theme]);
  const update = (change: Partial<DeviceSettings>) =>
    setSettings((current) => {
      const next = { ...current, ...change };
      saveSettings(next);
      return next;
    });
  return <SettingsContext.Provider value={{ settings, update }}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);

// The API request for a search: its own settings first, then the device's.
export function tripApiUrl(search: Search, settings: DeviceSettings, showHidden: boolean) {
  const params = new URLSearchParams({ from: search.from, to: search.to });
  const min = search.min ?? settings.min;
  const max = search.max ?? settings.max;
  const hide = search.hide ?? settings.hide;
  if (min !== null && min !== undefined) params.set('min', String(min));
  if (max !== null && max !== undefined) params.set('max', String(max));
  if (hide) params.set('hide', String(hide));
  if (settings.maxWalk !== DEFAULT_SETTINGS.maxWalk) params.set('walk', String(settings.maxWalk));
  if (settings.walkSpeed !== DEFAULT_SETTINGS.walkSpeed) params.set('speed', String(settings.walkSpeed));
  if (search.dest) params.set('dest', search.dest);
  if (search.firstRoutes?.length) params.set('r1', search.firstRoutes.join(','));
  if (search.secondRoutes?.length) params.set('r2', search.secondRoutes.join(','));
  if (showHidden) params.set('hidden', '1');
  return `/api/trip?${params}`;
}

// Whether the server's inlined results answer the same question this device would ask.
export function matchesServerDefaults(settings: DeviceSettings) {
  return settings.maxWalk === DEFAULT_SETTINGS.maxWalk && settings.walkSpeed === DEFAULT_SETTINGS.walkSpeed && settings.min === null && settings.max === null && settings.hide === 0;
}
