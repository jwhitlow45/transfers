import type { ComponentChildren } from 'preact';
import type { Stop } from '../../../shared/api.ts';
import { stopPage } from '../view.ts';
import { Name } from './Whole.tsx';

// A stop's name, linked to its agency's page when it has one, or plain text when it does not.
export function StopLink({ stop, children }: { stop: Stop | undefined; children: ComponentChildren }) {
  const page = stopPage(stop);
  // A name given as text wraps as every name does (see Name).
  const name = typeof children === 'string' ? <Name text={children} /> : children;
  if (!page) return <>{name}</>;
  return (
    <a class="tf-stop-link" href={page} target="_blank" rel="noopener">
      {name}
    </a>
  );
}
