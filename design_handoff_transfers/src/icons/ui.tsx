// Interface icons: stroke 1.75, round caps, 24×24. Inline SVG only.
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
type P = { size?: number };
const svg = (d: React.ReactNode, size = 22) => <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...S}>{d}</svg>;
export const IconBack = ({ size }: P) => svg(<path d="M15 18l-6-6 6-6" />, size);
export const IconSwap = ({ size }: P) => svg(<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" />, size);
export const IconSliders = ({ size }: P) => svg(<><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" /></>, size);
export const IconChevron = ({ size = 20 }: P) => svg(<path d="M6 9l6 6 6-6" />, size);
export const IconChevronRight = ({ size = 18 }: P) => svg(<path d="M9 6l6 6-6 6" />, size);
export const IconWarn = ({ size = 20 }: P) => svg(<path d="M12 3l9.5 17h-19zM12 10v4M12 17v.5" />, size);
export const IconInfo = ({ size = 20 }: P) => svg(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" /></>, size);
export const IconOffline = ({ size }: P) => svg(<path d="M2 8.5a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01M3 3l18 18" />, size);
export const IconClock = ({ size = 16 }: P) => svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>, size);
export const IconPencil = ({ size = 18 }: P) => svg(<path d="M4 20h4L19 9l-4-4L4 16z" />, size);
export const IconClose = ({ size }: P) => svg(<path d="M6 6l12 12M18 6L6 18" />, size);
