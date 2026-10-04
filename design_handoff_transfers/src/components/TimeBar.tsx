/** One shared clock per card: dotted wait, ride (ink), transfer gap (outlined, red fill when tight), second leg (route color). */
export interface TimeBarProps { rideStart: number; rideEnd: number; gapEnd: number; busEnd: number; busColor: string } // all 0–100 (%)
export function TimeBar({ rideStart, rideEnd, gapEnd, busEnd, busColor }: TimeBarProps) {
  const seg = (l: number, r: number) => ({ left: l + '%', width: Math.max(1.5, r - l) + '%' });
  return (
    <div className="tf-timebar" aria-hidden="true">
      <div className="tf-timebar__track" />
      <div className="tf-timebar__seg tf-timebar__ride" style={seg(rideStart, rideEnd)} />
      <div className="tf-timebar__seg tf-timebar__gap" style={seg(rideEnd, gapEnd)} />
      <div className="tf-timebar__seg" style={{ ...seg(gapEnd, busEnd), background: busColor }} />
    </div>
  );
}

export function TimeTicks({ scaleMinutes }: { scaleMinutes: number }) {
  const ticks = [];
  for (let k = 0; k < scaleMinutes; k += 15) ticks.push(k);
  return (
    <div className="tf-ticks" aria-hidden="true">
      {ticks.map(k => <span key={k} className="tf-tick" style={{ left: (k / scaleMinutes) * 100 + '%' }}>{k === 0 ? 'now' : '+' + k}</span>)}
    </div>
  );
}
