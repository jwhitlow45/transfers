import type { ComponentChildren } from 'preact';

// Interface icons: 24×24 strokes at 1.75 with round ends, inline so they cost no request.
// Preact core passes attribute names through as written, so SVG attributes are spelled with dashes.
type Props = { size?: number };

const icon = (children: ComponentChildren, size: number) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
    {children}
  </svg>
);

export const IconBack = ({ size = 22 }: Props) => icon(<path d="M15 18l-6-6 6-6" />, size);
export const IconSwap = ({ size = 22 }: Props) => icon(<path d="M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4" />, size);
export const IconSliders = ({ size = 22 }: Props) =>
  icon(
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>,
    size,
  );
export const IconChevron = ({ size = 20 }: Props) => icon(<path d="M6 9l6 6 6-6" />, size);
export const IconChevronRight = ({ size = 18 }: Props) => icon(<path d="M9 6l6 6-6 6" />, size);
export const IconWarn = ({ size = 20 }: Props) => icon(<path d="M12 3l9.5 17h-19zM12 10v4M12 17v.5" />, size);
export const IconInfo = ({ size = 20 }: Props) =>
  icon(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.01" />
    </>,
    size,
  );
export const IconOffline = ({ size = 22 }: Props) => icon(<path d="M2 8.5a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01M3 3l18 18" />, size);
export const IconPencil = ({ size = 18 }: Props) => icon(<path d="M4 20h4L19 9l-4-4L4 16z" />, size);
export const IconClose = ({ size = 22 }: Props) => icon(<path d="M6 6l12 12M18 6L6 18" />, size);
// Not in the handoff. Drawn to match the set above.
export const IconBookmark = ({ size = 22, filled = false }: Props & { filled?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.75" stroke-linejoin="round">
    <path d="M6 3.5h12v17l-6-4.5-6 4.5z" />
  </svg>
);
// A pushpin, filled once pinned. Not in the handoff. Drawn to match the set above.
export const IconPin = ({ size = 16, filled = false }: Props & { filled?: boolean }) =>
  icon(
    <>
      <path d="M9.5 3.5h5l-.5 6 3 3.5h-10l3-3.5z" fill={filled ? 'currentColor' : 'none'} />
      <path d="M12 13v7.5" />
    </>,
    size,
  );
// The pin, struck through, for a trip just unpinned.
export const IconUnpin = ({ size = 16 }: Props) =>
  icon(
    <>
      <path d="M9.5 3.5h5l-.5 6 3 3.5h-10l3-3.5z" />
      <path d="M12 13v7.5M4 4l16 16" />
    </>,
    size,
  );
export const IconLocation = ({ size = 20 }: Props) =>
  icon(
    <>
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>,
    size,
  );
// Eight teeth around a hub, built once from geometry rather than hand-drawn path data.
const COG = (() => {
  const points: string[] = [];
  for (let tooth = 0; tooth < 8; tooth++) {
    const center = (tooth * Math.PI) / 4;
    for (const [offset, radius] of [[-0.3, 7.4], [-0.17, 10], [0.17, 10], [0.3, 7.4]] as const) {
      const angle = center + offset;
      points.push(`${(12 + radius * Math.cos(angle)).toFixed(2)} ${(12 + radius * Math.sin(angle)).toFixed(2)}`);
    }
  }
  return `M${points.join('L')}Z`;
})();
export const IconGear = ({ size = 22 }: Props) =>
  icon(
    <>
      <path d={COG} />
      <circle cx="12" cy="12" r="3" />
    </>,
    size,
  );
// A new version of the app, as an arrow down into a circle, the usual mark for getting a newer
// copy, and unlike the refresh arrows the times use.
export const IconNewVersion = ({ size = 16 }: Props) =>
  icon(
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v9M8.5 13l3.5 3.5 3.5-3.5" />
    </>,
    size,
  );
// A solid gerbil out walking, with the pointed face of the one driving the vehicles (modeGlyphs.ts), for
// gerbil mode (see gerbils.ts) and the one that now and then rides the loading bar.
export const GerbilShape = () => (
  <>
    <path d="M6 18.2C5.2 13.9 7.6 9.6 11.6 9.6c2.3 0 3.9 1 5 2.2c1.6.5 3.3 1.4 4.8 2.4c-1.3.6-2.7.8-3.9 1.1c-1 .4-1.5 1.5-2.5 2c-1 .6-1.9.9-3 1H6Z" fill="currentColor" />
    <path d="M15.2 10.8c-.6-1.9.4-3.5 1.8-3.4 1.3.1 1.7 1.6.9 3.2Z" fill="currentColor" />
    <path d="M6.1 17.6c-2.8.6-4.8-.6-4.9-3.4" />
    <path d="M9 18.4l-1.2 2.1M15.2 17.6l.8 2.4" />
    {/* In the page's color, as a cut through the solid body. */}
    <circle class="tf-gerbil-eye" cx="17.5" cy="13.3" r=".85" stroke="none" />
  </>
);
export const IconGerbil = ({ size = 16 }: Props) => icon(<GerbilShape />, size);
// The phone's own share mark, a box with an arrow out of it, and a U-turn for the trip back.
export const IconShare = ({ size = 18 }: Props) => icon(<path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1" />, size);
export const IconReturn = ({ size = 18 }: Props) => icon(<path d="M9 14l-5-5 5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />, size);
export const IconFlag = ({ size = 16 }: Props) => icon(<path d="M6 21V4M6 4h11l-2.5 4 2.5 4H6" />, size);
export const IconTransfer = ({ size = 16 }: Props) => icon(<path d="M4 8h14l-4-4M20 16H6l4 4" />, size);
export const IconHidden = ({ size = 16 }: Props) =>
  icon(
    <>
      <path d="M3 12s3.5-6 9-6c1.6 0 3 .5 4.2 1.2M21 12s-3.5 6-9 6c-1.6 0-3-.5-4.2-1.2" />
      <path d="M4 20L20 4" />
    </>,
    size,
  );
export const IconRefresh = ({ size = 20 }: Props) => icon(<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4h-4" />, size);
