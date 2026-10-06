import { useRef, useState } from 'preact/hooks';
import { ScreenHeader } from '../components/ResultsHeader.tsx';
import { Toast, type ToastMessage } from '../components/Toast.tsx';
import { clock } from '../format.ts';
import { IconInfo, IconWarn } from '../icons/ui.tsx';
import { useSwipeBack } from '../gestures.ts';
import { navigate } from '../router.ts';
import { type DismissedNotice, dismissNotice, loadDismissed, restoreAllNotices, restoreNotice } from '../storage.ts';
import { noticeName } from '../lib/alerts.ts';
import { dayLabel } from '../view.ts';

// Notices the rider dismissed from results, newest first, as they read then, each with a way to
// put it back on every trip it concerns. Reached from the results that hid one, and Settings.
export function NoticesScreen() {
  // Back to the results the rider came from, or home when they opened this page directly.
  const back = () => (history.length > 1 ? history.back() : navigate('/'));
  useSwipeBack(back);
  const [notices, setNotices] = useState(loadDismissed);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const toastId = useRef(0);
  const reload = () => setNotices(loadDismissed());
  // Undo dismisses them again, oldest first, so the newest stays first.
  const redismiss = (list: DismissedNotice[]) => {
    for (const { at: _at, ...notice } of [...list].reverse()) dismissNotice(notice);
    reload();
  };
  const restore = (notice: DismissedNotice) => {
    restoreNotice(notice.id);
    reload();
    setToast({ id: ++toastId.current, text: `${noticeName(notice)} restored`, about: { severity: notice.severity ?? 'info' }, undo: () => redismiss([notice]) });
  };
  const restoreAll = () => {
    const all = notices;
    restoreAllNotices();
    reload();
    setToast({
      id: ++toastId.current,
      text: all.length === 1 ? `${noticeName(all[0]!)} restored` : `${all.length} notices restored`,
      about: { severity: all.length === 1 ? (all[0]!.severity ?? 'info') : 'info' },
      undo: () => redismiss(all),
    });
  };
  const now = Date.now();
  return (
    <>
      <div class="tf-scroll">
        <ScreenHeader title="Dismissed notices" onBack={back} />
        <main class="tf-page tf-page--form" id="main">
          {notices.length === 0 ? (
            <div class="tf-empty">
              <div class="tf-empty__title">No dismissed notices</div>
              <div class="tf-muted">Notices you dismiss from your results show here, so you can put them back.</div>
            </div>
          ) : (
            <>
              <p class="tf-muted tf-notices__intro">These stay hidden on every trip until you restore them, or the agency ends them.</p>
              <ul class="tf-notices">
                {notices.map((notice) => (
                  // Colored, with its icon, as it was in the results.
                  <li key={notice.id} class={`tf-notice tf-notice--${notice.severity ?? 'info'}`}>
                    <div class="tf-notice__kicker">
                      <span class="tf-notice__icon">{(notice.severity ?? 'info') === 'info' ? <IconInfo size={18} /> : <IconWarn size={18} />}</span>
                      <span class="tf-kicker">{notice.kicker}</span>
                    </div>
                    <div class="tf-notice__title">{notice.title}</div>
                    {notice.body && <p class="tf-notice__body">{notice.body}</p>}
                    <div class="tf-notice__foot">
                      <span class="tf-notice__meta">
                        <span>{notice.meta}</span>
                        {notice.url && (
                          <a href={notice.url} target="_blank" rel="noopener">
                            More from the agency
                          </a>
                        )}
                        <span>Dismissed {dismissedWhen(notice.at, now)}</span>
                      </span>
                      <button type="button" class="tf-btn-outline tf-btn-secondary tf-notice__restore" aria-label={`Restore notice: ${notice.kicker}, ${notice.title}`} onClick={() => restore(notice)}>
                        Restore
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {notices.length > 1 && (
                <button type="button" class="tf-btn-outline tf-btn-secondary" onClick={restoreAll}>
                  Restore all
                </button>
              )}
            </>
          )}
        </main>
      </div>
      <Toast message={toast} page onDone={() => setToast(null)} />
    </>
  );
}

// "today at 6:59 PM", "yesterday at …", or "on Monday at …".
function dismissedWhen(at: number, now: number) {
  const day = dayLabel(at * 1000, now);
  return `${day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : `on ${day}`} at ${clock(at)}`;
}
