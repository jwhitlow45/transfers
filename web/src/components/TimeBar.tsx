// One shared clock per screen: dotted wait, the ride (ink), the transfer gap (outlined, red when
// tight), then the second leg in its route color. Positions are percentages of the scale.
export function TimeBar({ rideStart, rideEnd, gapEnd, busEnd, busColor }: { rideStart: number; rideEnd: number; gapEnd: number; busEnd: number; busColor: string }) {
  const segment = (left: number, right: number) => ({ left: `${left}%`, width: `${Math.max(1.5, right - left)}%` });
  return (
    <div class="tf-timebar" aria-hidden="true">
      <div class="tf-timebar__track" />
      <div class="tf-timebar__seg tf-timebar__ride" style={segment(rideStart, rideEnd)} />
      <div class="tf-timebar__seg tf-timebar__gap" style={segment(rideEnd, gapEnd)} />
      <div class="tf-timebar__seg" style={{ ...segment(gapEnd, busEnd), background: busColor }} />
    </div>
  );
}

// Every 15 minutes, as the design draws them, until labels would crowd. Longer scales, such as
// a SamTrans departure two hours out, step by 30 or 60 instead.
export function TimeTicks({ scaleMinutes }: { scaleMinutes: number }) {
  const step = [15, 30, 60, 120].find((candidate) => scaleMinutes / candidate <= 5) ?? 120;
  const ticks: number[] = [];
  // A label past most of the width would run off the card's edge.
  for (let minute = 0; minute <= scaleMinutes * 0.85; minute += step) ticks.push(minute);
  return (
    <div class="tf-ticks" aria-hidden="true">
      {ticks.map((minute) => (
        <span key={minute} class="tf-tick" style={{ left: `${(minute / scaleMinutes) * 100}%` }}>
          {minute === 0 ? 'now' : `+${minute}`}
        </span>
      ))}
    </div>
  );
}
