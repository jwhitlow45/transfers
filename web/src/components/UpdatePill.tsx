import { IconNewVersion } from '../icons/ui.tsx';
import { forceRefresh, useUpdateAvailable } from '../update.ts';

// The site has a newer version than this page: a small pill at the bottom center of every screen,
// named as a version so it is not taken for refreshing the times. A tap loads it the same way as
// Settings' Force refresh. The region is always there, so screen readers announce it when it fills.
export function UpdatePill() {
  const available = useUpdateAvailable();
  return (
    <div class="tf-update-region" role="status">
      {available && (
        <button type="button" class="tf-update-pill" aria-label="A new version of Transfers is ready. Tap to load it" onClick={() => void forceRefresh()}>
          <IconNewVersion size={15} />
          <span aria-hidden="true">New version</span>
        </button>
      )}
    </div>
  );
}
