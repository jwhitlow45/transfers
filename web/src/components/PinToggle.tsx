// Pins or unpins a transfer, or a departure from a route already at From. It is a button stretched
// under the whole row, or a walk card's band, as the band's open and close button lies under the
// band: a tap anywhere but a link pins, and screen readers, keyboards, and switches reach one
// toggle. `label` names what it pins, such as "BART at 6:11 PM to the 49 at 6:22 PM".
export function PinToggle({ pinned, label, onToggle }: { pinned: boolean; label: string; onToggle: () => void }) {
  // Pinning puts the trip above the results and unpinning takes it away, which would move this
  // row from under the rider's finger. Browsers that hold the page still themselves leave
  // nothing to correct.
  const toggle = (event: { currentTarget: HTMLButtonElement }) => {
    const button = event.currentTarget;
    const before = button.getBoundingClientRect().top;
    onToggle();
    requestAnimationFrame(() => {
      const moved = button.getBoundingClientRect().top - before;
      if (moved) button.closest('.tf-scroll')?.scrollBy(0, moved);
    });
  };
  return <button type="button" class="tf-pin-toggle" aria-pressed={pinned} aria-label={`Pin ${label}`} onClick={toggle} />;
}
