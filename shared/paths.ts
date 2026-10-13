// A trip's own address, which the page opens and the server answers with its results inside.

// A search as the rider set it up. Labels are kept so lists render without a request.
export type Search = {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  min?: number;
  max?: number;
  hide?: number;
  // Where the rider is going on the second vehicle, which a stop's trips tab takes as the stop.
  dest?: string;
  destLabel?: string;
  firstRoutes?: string[];
  secondRoutes?: string[];
  // Transfer points the rider turned off, by pointId.
  off?: string[];
  // At a shared downtown station: ride from, or catch, only BART ("BA") or only Muni Metro ("SF").
  fromSystem?: 'BA' | 'SF';
  toSystem?: 'BA' | 'SF';
};

// /t/SF:13477/route:SF:48?fl=…&tl=…, with the From and To keys in the path.
export const TRIP_PATH = /^\/t\/([^/]+)\/([^/]+)$/;

export function tripPath(search: Search) {
  const params = new URLSearchParams();
  params.set('fl', search.fromLabel);
  params.set('tl', search.toLabel);
  if (search.min !== undefined) params.set('min', String(search.min));
  if (search.max !== undefined) params.set('max', String(search.max));
  if (search.hide !== undefined) params.set('hide', String(search.hide));
  if (search.dest) params.set('dest', search.dest);
  if (search.destLabel) params.set('dl', search.destLabel);
  if (search.firstRoutes?.length) params.set('r1', search.firstRoutes.join(','));
  if (search.secondRoutes?.length) params.set('r2', search.secondRoutes.join(','));
  if (search.off?.length) params.set('off', search.off.join(','));
  if (search.fromSystem) params.set('fm', search.fromSystem);
  if (search.toSystem) params.set('tm', search.toSystem);
  return `/t/${encodeURIComponent(search.from)}/${encodeURIComponent(search.to)}?${params}`;
}
