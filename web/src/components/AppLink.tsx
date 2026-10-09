import type { ComponentChildren } from 'preact';
import { goBack, navigate } from '../router.ts';

// A link to a page of the app, opened in place rather than by a reload. With `back`, it goes back
// to where the rider came from, which is `href` when they came from nowhere.
export function AppLink({ href, back, class: className, label, children }: { href: string; back?: boolean; class: string; label?: string; children?: ComponentChildren }) {
  return (
    <a class={className} href={href} aria-label={label} onClick={(event) => (event.preventDefault(), back ? goBack(href) : navigate(href))}>
      {children}
    </a>
  );
}
