import { approx, clock } from '../format.ts';

// A transfer on one clock, in Unix seconds: the ride on the first vehicle, the wait at the
// change, and the ride on the second. `busEnd` is null when the rider set no destination.
export type TripTimes = { rideStart: number; rideEnd: number; gapEnd: number; busEnd: number | null };

// Without a destination, the second vehicle's ride is drawn this long, as a stub that says it
// goes on.
const STUB_SECONDS = 8 * 60;
// Room after the trip's end, as a share of the scale, so the track runs on past it.
const TAIL = 0.1;

// Every 15 minutes, until labels would crowd. Longer scales, such as a SamTrans departure two
// hours out, step by 30 or 60 instead.
export function tickMinutes(scaleMinutes: number) {
  const step = [15, 30, 60, 120].find((candidate) => scaleMinutes / candidate <= 5) ?? 120;
  const ticks: number[] = [];
  // A label past most of the width would run off the edge.
  for (let minute = 0; minute <= scaleMinutes * 0.85; minute += step) ticks.push(minute);
  return ticks;
}

// The bar's scale, from now, or from when the ride began once it has, to a little past the trip's
// end. Each segment is its left edge and width, and each tick its place, all as percentages.
export function barScale({ rideStart, rideEnd, gapEnd, busEnd }: TripTimes, nowMs: number) {
  const now = nowMs / 1000;
  const start = Math.min(now, rideStart);
  const end = busEnd ?? gapEnd + STUB_SECONDS;
  const length = Math.max(60, end - start) * (1 + TAIL);
  const at = (seconds: number) => Math.max(0, Math.min(100, ((seconds - start) / length) * 100));
  // Never thinner than can be seen, as a one minute change still has to show.
  const segment = (from: number, to: number) => ({ left: at(from), width: Math.max(1.5, at(to) - at(from)) });
  // Ticks count from now, wherever now is on the scale, and stop once now has left it.
  const ahead = (start + length - now) / 60;
  const ticks = ahead <= 0 ? [] : tickMinutes(ahead).map((minute) => ({ minute, left: at(now + minute * 60) }));
  return { ride: segment(rideStart, rideEnd), gap: segment(rideEnd, gapEnd), bus: segment(gapEnd, end), ticks };
}

// "6:10–6:23", with one AM or PM left to the spoken text, which says it once at the end.
const bare = (unixSeconds: number) => clock(unixSeconds).replace(/ ?[AP]M$/, '');

// The words under the bar, one per segment, and the one sentence a screen reader gets in their
// place. `second` is the second vehicle's name, as its chip gives it. A time from the schedule
// alone is marked as everywhere else (see approx).
export function barText(
  { rideStart, rideEnd, gapEnd, busEnd }: TripTimes,
  { second, minutes, firstScheduled, secondScheduled, tight }: { second: string; minutes: number; firstScheduled: boolean; secondScheduled: boolean; tight: boolean },
) {
  const gapScheduled = firstScheduled || secondScheduled;
  return {
    legend: [
      `Ride ${approx(`${bare(rideStart)}–${bare(rideEnd)}`, firstScheduled)}`,
      `${approx(String(minutes), gapScheduled)} min transfer${tight ? ', tight' : ''}`,
      `${second} ${approx(busEnd === null ? bare(gapEnd) : `${bare(gapEnd)}–${bare(busEnd)}`, secondScheduled)}`,
    ] as const,
    spoken:
      `Ride ${bare(rideStart)} to ${clock(rideEnd)}${firstScheduled ? ', scheduled' : ''}, ` +
      `then a ${gapScheduled ? 'scheduled ' : ''}${minutes} minute transfer${tight ? ', tight' : ''}, ` +
      `then the ${second} ${busEnd === null ? `at ${clock(gapEnd)}` : `from ${bare(gapEnd)} to ${clock(busEnd)}`}${secondScheduled ? ', scheduled' : ''}`,
  };
}
