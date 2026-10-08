// When the control that had focus goes away, as a dismissed notice's button does, focus moves to
// `target`, what took its place, or else the page's main content, rather than dropping to the
// page itself, where keyboard and screen reader users lose their place.
export function focusInstead(target: HTMLElement | null | undefined) {
  const element = target ?? document.querySelector<HTMLElement>('.tf-layer #main');
  if (!element) return;
  if (!target) element.tabIndex = -1;
  element.focus({ preventScroll: true });
}
