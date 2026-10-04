/** First visit, no cache: blocks in the shape of the results. Static — the header refresh bar carries the motion. */
export function SkeletonResults() {
  const Row = ({ w1, w2 }: { w1: string; w2: string }) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'var(--countdown-col) 1fr', gap: 'var(--space-3)' }}>
      <div className="tf-skeleton__block" style={{ height: 44 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="tf-skeleton__block" style={{ height: 14, width: w1 }} />
        <div className="tf-skeleton__block" style={{ height: 14, width: w2 }} />
      </div>
    </div>
  );
  return (
    <div role="status" aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="tf-muted">Getting live predictions…</div>
      <div className="tf-skeleton"><div className="tf-skeleton__block" style={{ width: '60%', height: 22 }} /><Row w1="80%" w2="55%" /><Row w1="70%" w2="45%" /></div>
      <div className="tf-skeleton"><div className="tf-skeleton__block" style={{ width: '50%', height: 22 }} /><Row w1="75%" w2="50%" /></div>
    </div>
  );
}
