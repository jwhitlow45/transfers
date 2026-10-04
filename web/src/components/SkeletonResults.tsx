// First visit with nothing cached: blocks in the shape of the results. Static, since the
// header's refresh bar carries the motion.
function Row({ first, second }: { first: string; second: string }) {
  return (
    <div class="tf-skeleton__row">
      <div class="tf-skeleton__block" style={{ height: '44px' }} />
      <div class="tf-skeleton__lines">
        <div class="tf-skeleton__block" style={{ height: '14px', width: first }} />
        <div class="tf-skeleton__block" style={{ height: '14px', width: second }} />
      </div>
    </div>
  );
}

export function SkeletonResults() {
  return (
    <div class="tf-skeleton-list" role="status" aria-busy="true">
      <div class="tf-muted">Getting live predictions…</div>
      <div class="tf-skeleton">
        <div class="tf-skeleton__block" style={{ width: '60%', height: '22px' }} />
        <Row first="80%" second="55%" />
        <Row first="70%" second="45%" />
      </div>
      <div class="tf-skeleton">
        <div class="tf-skeleton__block" style={{ width: '50%', height: '22px' }} />
        <Row first="75%" second="50%" />
      </div>
    </div>
  );
}
