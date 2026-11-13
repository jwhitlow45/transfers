// When the control that had focus goes away, as a dismissed notice's button does, focus moves to
// `target`, what took its place, or else the page's main content, rather than dropping to the
// page itself, where keyboard and screen reader users lose their place.
// While a sheet over the whole app makes the page inert, its main can take no focus, and the sheet
// takes it instead.
export function focusInstead(target: HTMLElement | null | undefined) {
  if (target) return target.focus({ preventScroll: true });
  const main = document.querySelector<HTMLElement>('.tf-layer #main');
  const sheet = [...document.querySelectorAll<HTMLElement>('.tf-app > .tf-sheet:not([inert]) .tf-sheet__panel')].at(-1);
  if (main && !main.closest('[inert]')) {
    main.tabIndex = -1;
    main.focus({ preventScroll: true });
  } else sheet?.focus({ preventScroll: true });
}
