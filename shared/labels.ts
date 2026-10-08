import type { AgencyId } from './api.ts';

// How the app names a trip's stops and routes in its address and title. Shared so a short link,
// which the server opens with names (server/main.ts), reads as the app's own link does.

type Named = { agency: AgencyId; name: string };

// Chips say "BART" without the line color, which the chip shows and the spoken summary says.
export const chipLabel = (route: Named) => (route.agency === 'BA' ? 'BART' : route.name);

// BART's station names are long ("24th Street / Mission"). Headers use the short form riders say.
export function shortStopName(stop: Named | undefined, fallback = '') {
  if (!stop) return fallback;
  if (stop.agency === 'SF') {
    // Muni's platform names: "Metro Civic Center Station/Outbd" is Civic Center Station.
    const station = stop.name.match(/^(?:Metro )?(.+? Station)(?:\/.*| (?:Outbound|Inbound|Northbound|Southbound|Downtown))?$/);
    return station ? station[1]! : stop.name;
  }
  if (stop.agency !== 'BA') return stop.name;
  const name = stop.name.replace(/\bStreet\b/g, 'St');
  const [first, second] = name.split(' / ');
  if (!second) return name;
  return /^\d/.test(first!) ? `${first} ${second}` : first!;
}

// A stop as a trip names it: "24th St & Mission St (13477)", the code telling same-name stops apart.
export const stopLabel = (stop: Named & { code: string | null }) => shortStopName(stop) + (stop.code ? ` (${stop.code})` : '');
