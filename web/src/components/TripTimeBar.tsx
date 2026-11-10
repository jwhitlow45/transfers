import { type TripTimes, barScale, barText } from '../lib/time-bar.ts';

// A transfer on one clock, under its map: the ride (ink), the transfer (outlined, red when
// tight), then the second vehicle in its route color, over a dotted track from now. The results
// rows each carried one of these once, and it moved here to leave them one line each. The picture
// is one image to a screen reader, named by a sentence that says all three parts.
export function TripTimeBar({ times, now, color, second, minutes, firstScheduled, secondScheduled, tight }: {
  times: TripTimes;
  now: number;
  // The second vehicle's color and name, as its chip shows them.
  color: string;
  second: string;
  minutes: number;
  firstScheduled: boolean;
  secondScheduled: boolean;
  tight: boolean;
}) {
  const { ride, gap, bus, ticks } = barScale(times, now);
  const { legend, spoken } = barText(times, { second, minutes, firstScheduled, secondScheduled, tight });
  const place = ({ left, width }: { left: number; width: number }) => ({ left: `${left}%`, width: `${width}%` });
  return (
    <div class={`tf-tripbar${tight ? ' tf-tripbar--tight' : ''}`} role="img" aria-label={spoken}>
      <div class="tf-tripbar__track" aria-hidden="true">
        <span class="tf-tripbar__seg tf-tripbar__ride" style={place(ride)} />
        <span class="tf-tripbar__seg tf-tripbar__gap" style={place(gap)} />
        <span class="tf-tripbar__seg" style={{ ...place(bus), background: color }} />
      </div>
      <div class="tf-tripbar__ticks" aria-hidden="true">
        {ticks.map(({ minute, left }) => (
          <span key={minute} class="tf-tripbar__tick" style={{ left: `${left}%` }}>
            {minute === 0 ? 'now' : `+${minute}`}
          </span>
        ))}
      </div>
      <div class="tf-tripbar__legend" aria-hidden="true">
        {legend.map((text, index) => (
          <span key={index} class={index === 1 && tight ? 'tf-tripbar__tight' : undefined}>
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}
