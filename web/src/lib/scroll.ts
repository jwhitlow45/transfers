// Runs `change`, which may move the element on its page, such as a pin putting a trip above it,
// then scrolls the page by as much, so the element stays under the rider's finger. `after` runs
// once it has.
export function keepInPlace(element: () => HTMLElement | null, change: () => void, after?: (element: HTMLElement) => void) {
  const before = element()?.getBoundingClientRect().top ?? 0;
  change();
  requestAnimationFrame(() => {
    const moved = element();
    if (!moved) return;
    const by = moved.getBoundingClientRect().top - before;
    if (by) moved.closest('.tf-scroll')?.scrollBy(0, by);
    after?.(moved);
  });
}

// Where to scroll the element's page to show it `gap` pixels under the page's sticky header.
export function topUnderHeader(element: HTMLElement, gap: number) {
  const scroller = element.closest<HTMLElement>('.tf-scroll');
  if (!scroller) return null;
  const header = scroller.querySelector('.tf-header')?.getBoundingClientRect().height ?? 0;
  return { scroller, top: Math.max(0, element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - header - gap) };
}
