import type { ComponentChildren } from 'preact';
import type { Stop } from '../../../shared/api.ts';
import { stopPage } from '../view.ts';

// A stop's name, linked to its agency's page when it has one, or plain text when it does not.
export function StopLink({ stop, children }: { stop: Stop | undefined; children: ComponentChildren }) {
  const page = stopPage(stop);
  if (!page) return <>{children}</>;
  return (
    <a class="tf-stop-link" href={page} target="_blank" rel="noopener">
      {children}
    </a>
  );
}
